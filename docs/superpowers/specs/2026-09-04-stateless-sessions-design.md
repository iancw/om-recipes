# Stateless Session Verification — Design Spec

**Date:** 2026-09-04
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Neon's compute bill is driven by wall-clock active time (scale-to-zero
is already on: 5 minutes idle, 0.25–2 CU). `getSession()`
(`lib/auth.js:282`) runs on every logged-in page view — including
`app/recipes/[id]/page.jsx`, the site's highest-traffic route — and
does two real DB round trips each time (a joined `authSessions` +
`users` lookup, then a separate `authors` lookup). With enough
logged-in traffic spread through the day, requests land more often
than the 5-minute idle window, so the compute never gets a gap to
suspend and runs effectively continuously.

This change replaces the per-request DB session check with a signed,
tamper-evident cookie that carries the session identity directly.
Ordinary page views verify the cookie's signature and expiry only — no
DB call. The DB is only consulted periodically (once a week) to catch
revocation, and on the existing write paths (login, logout,
magic-link consumption).

## Scope decisions

1. **No ban/revocation feature exists today, and this change does not
   add one.** The only way a session becomes invalid before it expires
   is the user logging out on that device. A future ban feature is out
   of scope; the revalidation interval (§2) is a single named constant
   specifically so it can be tightened later without a redesign.

2. **`authSessions` table and its write paths are unchanged.** Session
   creation, `tokenHash` lookup, and deletion on logout all work exactly
   as they do today. This change only alters how `getSession()` *reads*
   session state — no schema change, no migration.

3. **Revalidation interval is 1 week**, matching roughly half the
   14-day `SESSION_MAX_AGE_SECONDS` session lifetime. Most sessions
   revalidate against the DB once or twice over their whole life.
   Logout on the *current* device is still instant (the cookie is
   cleared directly); a session left logged in on another idle device
   picks up a revocation up to a week later. Acceptable since nothing
   can revoke a session today besides that same-device logout.

4. **Author profile data is not part of the session at all.** The
   `authors` join `getSession()` runs today only matters to three
   low-traffic, already-authenticated pages (`app/upload/page.jsx`,
   `app/user/page.jsx`, `app/profile/page.jsx`) — never to
   `app/recipes/[id]/page.jsx`, the actual cost driver, which only ever
   needs `session.user.id`. Embedding author data in the cookie would
   only add payload size and a staleness tradeoff for no benefit on the
   route that matters. Instead, those three pages fetch the `authors`
   row directly (see §3a) — the same query `getSession()` runs today,
   just narrowed to where it's actually used.

5. **Email is not part of the session either — for privacy, not just
   cost.** Unlike an opaque session id, an email address is personal
   data that shouldn't sit in more places than necessary: embedding it
   in the cookie means it also lives in the browser's cookie store for
   up to two weeks and travels in the `Cookie` header of every request,
   which widens exposure to things like request logging or
   error-tracking tools that capture headers — and unlike a DB row, a
   value that's already been logged that way can't be deleted after the
   fact. Tracing every use of `session.user.email` shows it only ever
   feeds `defaultDisplayNameFromEmail()` as a fallback display name (for
   users with no author row yet) or a handful of low-traffic call sites
   — never the cost-driving read path. Those call sites fetch
   `users.email` directly instead (see §3a, §3b).

## 1. Signed cookie payload

New module-level constants in `lib/auth.js` (or a new
`lib/auth-session-token.js` if `auth.js` gets unwieldy — implementer's
call):

```js
const SESSION_REVALIDATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
```

Payload shape (JSON):

```js
{
  sid,           // authSessions.id — used only during revalidation
  uid,           // users.id
  uuid,          // users.uuid
  iat,           // issued-at, ms epoch
  exp,           // session expiry, ms epoch (mirrors authSessions.expiresAt)
  reval          // last-revalidated-at, ms epoch
}
```

No author data (scope decision 4) and no email (scope decision 5) —
just opaque internal identifiers. Nothing in this payload is personal
data on its own.

Cookie value: `base64url(JSON.stringify(payload)) + '.' + base64url(hmac)`,
where `hmac = createHmac('sha256', AUTH_SESSION_SIGNING_SECRET).update(payloadB64)`.
Built with `node:crypto` (`createHmac`, `timingSafeEqual`) — no new
dependency, consistent with the existing `createHash`/`randomBytes`
usage in `lib/auth.js`.

New required env var: `AUTH_SESSION_SIGNING_SECRET` (a long random
string, e.g. `openssl rand -base64 32`). Document it in `README.md`
alongside the other auth env vars (`APP_BASE_URL`, `AUTH_COOKIE_DOMAIN`,
listed around line 77). Rotating this secret invalidates every
outstanding session cookie at once — a deliberate, useful kill switch,
not a failure mode to guard against.

## 2. `getSession()` verification flow

Replaces the current unconditional DB read in `lib/auth.js:282`:

1. No cookie → return `null` (unchanged, no DB call).
2. Cookie present → split into `payloadB64`/`sigB64`, recompute the
   HMAC over `payloadB64`, compare with `timingSafeEqual`. Mismatch →
   clear cookie, return `null`, no DB call.
3. Signature valid → parse payload, check `payload.exp > now`. Expired
   → clear cookie, return `null`, no DB call.
4. `now - payload.reval < SESSION_REVALIDATION_INTERVAL_MS` → build and
   return `{ user: { id: uid, uuid }, session }` directly from the
   payload fields (no `author`, no `email` — see scope decisions 4 and
   5). **No DB call.** This is the path every ordinary logged-in page
   view takes.
5. Otherwise (revalidation due) → the one DB path: join `authSessions`
   (by `sid`) with `users`, check `revokedAt is null and expiresAt >
   now`. No `authors` join here — `getSession()` never needed it beyond
   what's now in §3a.
   - Row missing / expired / revoked → clear cookie, return `null`.
   - Row valid → this **replaces** today's `touchSessionIfNeeded`: bump
     `authSessions.expiresAt`/`lastSeenAt`, build a fresh payload with
     `iat`/`reval` reset to now and `exp` extended, sign it, set the
     cookie, and return the refreshed session.

`session.author` is no longer part of `getSession()`'s return value.

`requireUser()` is unchanged — it still just checks `session?.user` and
throws.

## 3. Login / logout / magic-link consumption

- `consumeMagicLink` (`lib/auth.js`) still creates the `authSessions`
  row exactly as today. After creating it, it also builds and signs the
  cookie payload (fresh `iat`/`reval`/`exp`) and sets it via the same
  `setSessionCookie`, now cookie-payload-aware instead of
  token-only.
- `logoutCurrentSession` still deletes the `authSessions` row and
  clears the cookie, but looks the row up by `sid` (from the cookie
  payload) instead of hashing a raw token — the signed cookie itself is
  now the credential, so the separate opaque-token/`tokenHash` lookup
  it uses today is no longer needed for this path.
  `deleteSessionByToken` becomes `deleteSessionById(sid)`. End-user
  behavior (row deleted, cookie cleared) is unchanged.
- `sendMagicLinkEmail` / `createMagicLink` are untouched — they don't
  go through `getSession()`.
- `authSessions.tokenHash` is `NOT NULL` with a unique index (schema
  unchanged, per scope decision 2), so session creation keeps
  generating and storing the random token/hash exactly as today. It
  just stops being the *read-path* lookup key — revalidation and
  logout look the row up by `sid` (the primary key) instead. The
  column becomes otherwise unused; leaving it in place avoids a
  migration and keeps the door open for a future feature (e.g.
  per-device "sign out this session" from a token) without redesigning
  the table.

## 3a. Author data and email move to their three page callers

`app/upload/page.jsx`, `app/user/page.jsx`, and `app/profile/page.jsx`
currently read `session.author` and (for the display-name fallback,
below) `session.user.email`. Each needs both, so each runs a single
query joining `users` to `authors` by `session.user.id` rather than two
separate lookups:

```js
const [row] = await db
    .select({
        email: users.email,
        authorId: authors.id,
        authorUuid: authors.uuid,
        authorName: authors.name,
        instagramLink: authors.instagramLink,
        flickrLink: authors.flickrLink,
        website: authors.website,
        kofiLink: authors.kofiLink
    })
    .from(users)
    .leftJoin(authors, eq(authors.userId, users.id))
    .where(eq(users.id, session.user.id))
    .limit(1);
```

(`leftJoin` because a user may not have an author row yet.) One query,
same total cost as fetching just `authors` alone would have been —
just narrowed to the three places that need it instead of
unconditionally on every session read the way `getSession()` does
today.

**Display-name fallback.** The old `getSession()` computed
`session.user.name` as `author?.name ?? defaultDisplayNameFromEmail(email)`
— a fallback for users who haven't created an author row yet (author
rows are created lazily on first upload/edit, not at signup). Neither
`author` nor `email` is on the session anymore, so each of the three
callers computes the fallback from its own query result above, using
the already-exported `defaultDisplayNameFromEmail` (`lib/auth.js`):

- `app/user/page.jsx:26` — `<p>Name: {row?.authorName ?? defaultDisplayNameFromEmail(row?.email)}</p>`
- `app/profile/page.jsx:53` — `name: row?.authorName ?? defaultDisplayNameFromEmail(row?.email)`
- `app/upload/page.jsx:57` — `initialAuthor={row?.authorName ?? defaultDisplayNameFromEmail(row?.email)}`

`app/auth/session/route.js` also currently returns `email` and `name`
fields that its only caller (`components/HeaderNav.jsx`, which only
checks `Boolean(session?.user)`) ignores entirely. Drop both from that
route's response rather than reconstruct them — doing so accurately
would require a DB query in a route that's deliberately kept DB-free,
and neither is used by anything today.

## 3b. Email moves to its write-action callers

Three write actions pass `session.user.email` into
`findOrCreateAuthorForUser` (`lib/auth.js:96`), which only uses `email`
to build a fallback name (`defaultDisplayNameFromEmail(email)`) when no
`displayName` is given:

- `app/profile/actions.js:31` always passes a required, non-empty
  `displayName` (`updateMyProfileAction` throws if `name` is blank), so
  the `email` fallback branch can never trigger there. **Stop passing
  `email`** — it was already dead.
- `app/upload/actions.js:674` passes `displayName: author`, but
  `prepareRecipeUploadAction` already rejects the request earlier
  (`isBlank(author)` at line 615, `'Author Name is required'`) if
  `author` is blank — the same emptiness check
  `findOrCreateAuthorForUser`'s fallback branch would key off. By the
  time this call runs, `author` is guaranteed non-blank, so the `email`
  fallback can never trigger here either. **Stop passing `email`** —
  also already dead, same as `app/profile/actions.js`.
- `app/recipes/[id]/actions.js:424` (the comment action) passes no
  `displayName` at all and has no equivalent guard — for a first-time
  commenter with no author row yet, `email` is the *only* name source,
  and this is the one real remaining use. Add a small
  `select email from users where id = session.user.id` query here,
  only reached on this write path (low traffic, and only actually
  needed on the no-existing-author edge case).

`app/login/page.jsx:45` also reads `session.user.email` directly
(`You're already signed in as {email}`) to inform a user who navigates
to `/login` while already authenticated. Same fix: a one-column
`select email from users where id = session.user.id` query on that
page. This route is rarely hit (only when an already-logged-in user
opens `/login`) and isn't the cost driver either way.

## 4. Dead code removed

`refreshSessionCookieIfPresent` (`lib/auth-session-cookie.js:36`) has
no callers anywhere in the repo (no `middleware.ts` exists). Remove it
rather than adapting it to the new payload shape.

## 5. Testing

**Unit (new, e.g. `tests/auth-session-token.test.js`):**

- Sign then verify round-trips a payload.
- Tampered payload (flip a byte) fails verification.
- Expired `exp` fails verification.
- Wrong secret fails verification.
- `reval` boundary: just under the interval → no DB path taken; just
  over → DB path taken (this part mocked/unit-level, not a real DB
  call).

**`tests/auth-routes.test.js` (existing):** update fixtures for the new
cookie shape; verify login sets a valid signed cookie, logout clears it
and deletes the `authSessions` row.

**Manual verification:** log in, load a recipe page repeatedly, and
confirm (via Neon's query log, or temporary logging around `db` calls
in dev) that no query fires on `getSession()` reads within the
revalidation window.

## Files touched

| File | Change |
|------|--------|
| `lib/auth.js` | rewrite `getSession()` (drops `author`, `email`), `consumeMagicLink`, `logoutCurrentSession`; add sign/verify helpers and `SESSION_REVALIDATION_INTERVAL_MS` |
| `lib/auth-session-cookie.js` | remove unused `refreshSessionCookieIfPresent`; cookie option helpers stay |
| `app/upload/page.jsx` | fetch `users`+`authors` (joined) directly instead of `session.author`/`session.user.email`; use `defaultDisplayNameFromEmail` fallback |
| `app/user/page.jsx` | fetch `users`+`authors` (joined) directly instead of `session.author`/`session.user.email`; use `defaultDisplayNameFromEmail` fallback |
| `app/profile/page.jsx` | fetch `users`+`authors` (joined) directly instead of `session.author`/`session.user.email`; use `defaultDisplayNameFromEmail` fallback |
| `app/auth/session/route.js` | drop unused `email`/`name` fields from the JSON response |
| `app/profile/actions.js` | stop passing `email` to `findOrCreateAuthorForUser` (already dead there) |
| `app/upload/actions.js` | stop passing `email` to `findOrCreateAuthorForUser` (already dead there too — `isBlank(author)` guard) |
| `app/recipes/[id]/actions.js` | fetch `users.email` directly for the comment-action author fallback (the one real remaining use) |
| `app/login/page.jsx` | fetch `users.email` directly for the "already signed in as" display |
| `README.md` | document `AUTH_SESSION_SIGNING_SECRET` alongside the other auth env vars |
| `tests/auth-session-token.test.js` | new — sign/verify unit tests |
| `tests/auth-routes.test.js` | update for new cookie shape and `getSession()` return value |

## Future work (explicitly out of scope here)

A ban/force-revocation feature would want the revalidation interval
tightened (or a separate fast-path revocation check) so a ban takes
effect sooner than a week. `SESSION_REVALIDATION_INTERVAL_MS` is kept
as a single named constant for exactly this reason.
