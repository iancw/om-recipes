# Blob-Cached User State & Public Recipe Data Caching — Design Spec

**Date:** 2026-09-04
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Neon's compute bill is driven by wall-clock active time. The
`stateless-sessions` work (see
`docs/superpowers/specs/2026-09-04-stateless-sessions-design.md`)
removes the biggest source of that — a DB read on every logged-in page
view just to verify who's asking. This spec covers the next layer: the
per-user *data* those page views actually want to show (saved-recipe
state, notifications, unread count) and the writes users trigger
(saving/unsaving a recipe, marking notifications read).

Today those are handled by simply not querying them. Commit `d59e50c`
("Changes to allow main page to load without hitting DB") hardcoded
`isSaved: false` on every recipe card and detail page instead of
checking the DB, and `NotificationBell` already fetches nothing until
the user opens it. The save case is a real correctness bug, not just
staleness: `app/recipes/save/route.js`'s toggle has no idea what the
DB actually contains, so clicking "save" on a recipe you'd already
saved un-saves it.

This spec replaces "don't query it" with "query a cache that's cheap
enough to always query." Netlify Blobs — already a dependency (used
today by `lib/privacy-artifacts.js`) — becomes a durable per-user cache
that ordinary reads hit instead of Postgres, and a durable write buffer
that absorbs save-toggles and read-receipts until it's actually
necessary to reconcile them into Postgres. Comments, recipe uploads,
and sample-image adds are unaffected — they stay fully synchronous,
exactly as today.

Separately, this spec also closes a gap in the site's *other* caching:
the recipe detail page — "the site's highest-traffic route" per the
`stateless-sessions` spec — runs a live, uncached Postgres query on
every single view (`getRecipeByIdOrSlug` and `getCommentsForRecipe` are
only wrapped in React's per-request `cache()`, which doesn't persist
across requests at all). And while the homepage's infinite-scroll grid
does use Next's `unstable_cache` (`lib/public-recipe-catalog.js`), its
cache key includes `offset`/`sortBy`/`type`/`query`, so every distinct
scroll depth × sort × filter combination is its own cache entry —
scrolling past the first page is a near-guaranteed cache miss. §9
covers caching both properly, reusing the existing `revalidateTag`
mechanism the catalog cache already established rather than inventing
a second approach.

## Goals

- The save button always reflects true state and toggling it is always
  correct — no more blind flips.
- The notification bell shows a live-ish unread badge and updates
  within roughly a minute of the triggering event, without polling the
  DB.
- Ordinary page views (recipe detail, search/browse grids, notification
  polls) never touch Postgres once a user's cache — or the relevant
  shared recipe cache — is warm.
- Recipe detail pages and their comments are served from cache after
  the first view of that recipe, invalidated only for the specific
  recipe(s) a write actually touched.
- The homepage/catalog grid stays cache-warm across scroll depth, sort,
  and filter combinations, not just the first page with default
  filters.
- Neon gets long, uninterrupted idle stretches — at most one write
  batch per hour, plus whatever DB traffic already exists for other
  reasons (comments, uploads, logins, weekly session revalidation, and
  the first view of a given recipe or user after this ships).

## Non-goals

- True push (WebSocket/SSE) delivery. Out of scope — would require
  standing infrastructure beyond Netlify functions, and near-live
  polling against a cache satisfies the actual requirement.
- Deferring comments, recipe uploads, or sample-image writes. These
  stay synchronous; they're already rarer and users expect them
  durable immediately.
- Caching the recipe detail page's owner-only save count.
  `getSaveCountForRecipe` is only ever queried there, and only when the
  viewer is that recipe's own owner (`app/recipes/[id]/page.jsx:275`,
  `isOwner ? await getSaveCountForRecipe(...) : null`). It's already a
  narrow, low-traffic, gated read — not a cost driver — so it stays a
  plain live DB query, untouched by this spec. (This is distinct from
  the catalog's own per-recipe save count, used for "most saved"
  sorting on every card — that one *is* covered, folded into the
  recipe index cache in §9a.)

## Relationship to `stateless-sessions`

This work assumes `stateless-sessions` has landed: `getSession()`
returns `{ user: { id, uuid } }` from a signed cookie with no DB call
on the common path. Everything below keys off `session.user.uuid`,
which is available with zero DB cost.

## 1. Per-user state blob

One JSON blob per user, key `state/users/<uuid>.json`, in a Netlify
Blobs store dedicated to this feature (separate from the existing
privacy-artifacts store).

```js
{
  savedRecipeIds: [123, 456],           // number[]
  notifications: [
    {
      uuid, type,                        // matches notifications table
      recipeId, recipeSlug, recipeName,
      actorAuthorName,
      sampleImageId,                     // null for non-sample-image types
      dedupeKey,
      createdAt,                         // ms epoch
      readAt                             // ms epoch or null
    },
    // ... newest first, capped at 50 (matches getNotificationsForUser's default limit)
  ],
  preferences: {
    notifyNewRecipe, notifySampleImage, notifySave, notifyComment,
    emailDigestEnabled
  },
  hydratedAt                             // ms epoch, when this blob was last built from Postgres
}
```

`unreadCount` is not stored separately — it's `notifications.filter(n
=> n.readAt == null).length`, computed on read, so it can never drift
from the notification list itself.

### Hydration (cache miss)

If the blob doesn't exist for a given `uuid` (first page view ever
after this ships, or a brand-new signup), the request that discovers
this runs one Postgres read — the same shape of query
`getSavedRecipeIdsForUser`, `getNotificationsForUser`, and
`getEffectivePreferences` already do today, combined into one
hydration path — writes the resulting blob, and serves from it. Every
subsequent request for that user is blob-only. No migration/backfill
script is needed; the cache self-heals lazily, once, per user.

## 2. Read path

Every place that currently reads `session.author`/DB for per-user
state instead reads the blob:

- **Recipe detail page** (`app/recipes/[id]/page.jsx`) and **search
  route** (`app/recipes/search/route.js`): `isSaved` for each rendered
  recipe comes from `blob.savedRecipeIds.includes(recipeId)` — always
  correct, no DB call. This directly fixes the d59e50c regression.
- **`GET /api/notifications`** (backing `NotificationBell`): returns
  `blob.notifications` and the derived unread count, straight from the
  blob.
- **Notification preferences page**: reads `blob.preferences` for
  display; still writes through to Postgres synchronously on save (see
  §5) since preference changes are rare and low-stakes to leave
  buffered.

The public catalog listing and recipe detail data are a *different*
cache — shared across all viewers, not per-user — covered in §9. The
owner-only recipe save count stays a plain live query (see Non-goals).

## 3. Write path — save toggle

`POST /recipes/save` (`app/recipes/save/route.js`) changes from "flip
whatever Postgres says" to:

1. Read the acting user's blob (strong-consistency read, since this
   request may have just written it moments ago in a prior request).
2. Flip membership of `recipeId` in `savedRecipeIds`.
3. Write the blob back.
4. Mark the user dirty (§5).
5. If saving (not unsaving) and the recipe owner has `notifySave` on
   (from the *owner's* cached preferences, hydrating their blob if
   needed) and no notification with the same `dedupeKey`
   (`save:<recipeId>:<saverUserId>`, matching today's
   `saveDedupeKey`) already exists in the owner's cached notification
   list: append the notification to the **owner's** blob and mark the
   owner dirty too.
6. Return the new `isSaved` read from the blob just written.

No Postgres write happens on this request. `lib/recipe-saves.js`'s
`toggleSavedRecipeForUser` and `lib/notifications.js`'s
`notifyRecipeSaved` are superseded for this path by the blob-based
logic above; they remain as-is for the reconciliation job (§5), which
still needs to write real rows eventually.

**Un-save after save, before flush:** if a user saves then unsaves
before the notification is reconciled, the owner's cached notification
entry is *not* retracted — this matches today's behavior, where an
already-created `notifications` row isn't deleted on unsave either.

## 4. Write path — read receipts

Opening the notification bell (existing `POST
/api/notifications/read`) updates the viewer's own blob directly:
sets `readAt` on the relevant cached notification entries (or all
unread ones, matching today's "mark all read" behavior) and marks the
user dirty. No Postgres write on this request.

## 5. Reconciliation (flush)

**Dirty tracking:** marking a user dirty writes a small presence key
`pending/<uuid>` (e.g. `{ since }`) to Blobs. This list is the flush
job's work queue.

**Scheduled flush:** a new Netlify scheduled function,
`netlify/functions/state-cache-flush.js`, using the same `schedule()`
helper as the existing `notification-digest.js`, running `@hourly`
(unconditional — no time-of-day gate). For each key under `pending/`:

1. Read that user's blob.
2. **Saves:** treat `blob.savedRecipeIds` as desired end state. Query
   Postgres for the user's current `savedRecipes` rows, insert what's
   missing, delete what's extra. No event log needed — `savedRecipes`
   has no surrogate id, just a `(userId, recipeId)` membership pair, so
   a direct set-diff is sufficient and idempotent to retry.
3. **Notifications:** insert each blob-cached notification into
   `notifications` via `onConflictDoNothing` on `dedupeKey` (already a
   unique constraint) — safe to retry, safe if some were already
   flushed via piggyback (§6).
4. **Read receipts:** for cached notifications with `readAt` set,
   update the matching Postgres rows' `readAt` where still null.
5. Remove the `pending/<uuid>` key.

If any step throws, leave the `pending/<uuid>` key in place — the next
hourly run retries the whole user, safely, because every step above is
idempotent.

## 6. Piggyback flush

Any action that already forces a synchronous Postgres write for a
specific user — posting a comment, uploading a recipe, adding a sample
image, changing notification preferences, logging in/magic-link
consumption — runs that same one-user reconciliation (§5, scoped to
just that `uuid`) inline immediately after its own write commits, then
clears their `pending/` key if present. This keeps active users fully
synced in near-real-time without adding any *extra* DB wake-ups (the
DB is already awake for their real write); only genuinely idle users'
buffered saves wait for the hourly sweep.

## 7. Notification bell polling

`NotificationBell` gains:

- An unread-count badge, fetched on mount from `GET
  /api/notifications` (now cache-backed, so this no longer reintroduces
  a per-page-view DB cost).
- Polling every 45s while the tab is visible (`document.hidden ===
  false`), paused when hidden, resumed with an immediate refresh on
  `visibilitychange` back to visible. This is what makes notifications
  feel live — a save or comment shows up within 45s without opening the
  bell — while every poll is a Blobs read, not a DB query.

## 8. Consistency & failure modes

- **Read-after-write:** requests that read a blob they (or a very
  recent prior request) just wrote use Netlify Blobs' strong-consistency
  read option, so a user never sees a stale copy of their own just-made
  change.
- **Concurrent toggles:** two simultaneous save-toggle requests for the
  same user (double-click, two tabs) race on a read-modify-write of one
  blob with no locking. Accepted as a low-stakes edge case — worst case
  is a lost toggle, which the user can just click again. Not worth
  distributed-locking complexity for this.
- **Digest interaction:** `runDailyDigest` (existing, `@hourly` gated to
  6pm Eastern) reads `notifications` from Postgres directly. A
  notification created via a save in the hour before 6pm may not be
  reconciled into Postgres until slightly after 6pm, missing that day's
  digest and appearing in the next one instead. Accepted — a same-day
  digest delivery delay of under an hour for one notification type is a
  minor cosmetic gap, not a correctness issue (the notification itself
  is never lost).
- **Flush job never runs (misconfiguration, deploy issue):** buffered
  saves/read-receipts stay in Blobs indefinitely — durable, not lost,
  just unreconciled. Recoverable by fixing the job and letting it catch
  up; worth an operational note (see Future work) but not a design
  blocker.
- **Catalog "most saved" sort staleness:** the recipe index (§9a) reads
  `saveCount` from Postgres, which itself lags up to an hour behind a
  batch of buffered save-toggles (§5). A recipe that just got saved a
  few times won't climb the "most saved" sort until the next flush (or
  cache refresh) reconciles it. Accepted, same tradeoff as everywhere
  else in this design — recency for popularity ranking isn't worth a
  DB hit.

## 9. Public recipe data caching

This tier is separate from the per-user Blobs cache above: it's shared
across every viewer, not scoped to one user, so it uses Next.js's
existing `unstable_cache`/`revalidateTag` mechanism (the same one
`lib/public-recipe-catalog-cache.js` already established for the
catalog) rather than Blobs.

### 9a. Recipe index cache

A new cached function, `getRecipeIndex()`, wraps one Postgres query
that returns essentially what `fetchRecipeCatalog` returns today for
one full unfiltered page — every recipe's card-rendering fields
(`id`, `uuid`, `slug`, alias slugs, `recipeName`, `authorName`,
`authorUserId` (needed for the `onlyMine` filter), `type`,
`description`, `createdAt`, `saveCount`, and the full
`comparisonImages`/`sampleImages` arrays each card needs to render —
the search UI switches between "author sample" and comparison-image
views entirely client-side over already-fetched data, so these can't
be trimmed to a single thumbnail) — with no `offset`/`limit`. This is
a small catalog (51 recipes in the current seed data, so low hundreds
at most for the foreseeable future), so caching the *entire* set as one
JSON payload is cheap; there's no need for a leaner per-card index
shape. It's cached under the existing `PUBLIC_RECIPE_CATALOG_CACHE_TAG`
(so every write site that already calls
`revalidatePublicRecipeCatalog()` continues to invalidate it, no new
call sites needed for this part) with the same 24h fallback
`revalidate`.

Two things now read this cached array **in memory** instead of
querying Postgres per request:

- `app/recipes/search/route.js` (backing the homepage's infinite
  scroll): sorts, filters, and paginates the cached array directly.
  This collapses the cache-key explosion described in the Summary — one
  shared cache entry (per `PUBLIC_RECIPE_CATALOG_CACHE_TAG` generation)
  serves every scroll depth, sort order, and search/type filter,
  instead of a distinct Postgres round-trip per combination.
  `onlyMine` filters the cached array by `authorUserId === session.user.id`
  in memory. `onlySaved` filters it against the requesting user's
  `blob.savedRecipeIds` (§1) — reusing the per-user cache already built
  for the save-button fix, rather than a DB query. Neither path touches
  Postgres.
- The recipe detail page's slug/uuid/alias → id resolution (currently
  a live query inside `getRecipeByIdOrSlug`) becomes an in-memory
  lookup against this same cached index, eliminating that query
  entirely rather than just caching it.

### 9b. Recipe detail cache

Once a request resolves to a numeric recipe id (via 9a), the "heavy"
per-recipe payload — full color/mono settings, sample and comparison
images, comments — is fetched through a cache wrapped per-id, following
Next's standard per-entity-tag pattern (construct the `unstable_cache`
call inside a function parameterized by `recipeId`, so the tag array
can include a per-recipe tag). Both this and §9c's invalidation helper
share one `recipeDetailTag(id)` function (returning `` `recipe-detail:${id}` ``)
so the tag string can't drift between where it's set and where it's
invalidated:

```js
function getCachedRecipeDetail(recipeId) {
    return unstable_cache(
        () => fetchRecipeDetail(recipeId),
        ['recipe-detail', String(recipeId)],
        { tags: [recipeDetailTag(recipeId)], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
    )();
}
```

First viewer of a given recipe after a cache generation pays one
Postgres fetch (settings + images + comments, same shape as today's
combined query); every subsequent viewer of that same recipe reads the
cache. A change to recipe A never invalidates recipe B's cache — only
`recipe-detail:<A>` gets busted.

### 9c. Invalidation at write sites

A new helper, `revalidateRecipeDetail(recipeId)`
(`lib/public-recipe-catalog-cache.js`, alongside
`revalidatePublicRecipeCatalog`), calls
`revalidateTag(recipeDetailTag(recipeId), 'max')` where
`recipeDetailTag(id)` returns the string `` `recipe-detail:${id}` ``.
It's added next to the *existing*
`revalidatePublicRecipeCatalog()` call at every write site that already
has a `recipeId` in scope: comment add/delete, recipe update/delete,
slug rename, and sample-image add/delete/set-primary
(`app/recipes/[id]/actions.js`, `app/upload/actions.js`).

Two write sites affect *multiple* recipes at once and need a small
extra step — both already do a synchronous DB write, so one more cheap
`select id from recipes where author_id in (...)` (or reusing rows
already fetched/deleted) and a loop over `revalidateRecipeDetail(id)` is
negligible in context:

- `app/profile/actions.js`'s `updateMyProfileAction` — an author's
  name/social links are denormalized onto every one of their recipes'
  detail pages, so all of that author's recipe ids need invalidating.
- `lib/privacy.js`'s account-deletion path — deletes recipes (possibly
  across multiple authors for a multi-author account); each deleted
  id's cache must be busted so a stale cached copy of a now-deleted
  recipe can never be served.

### 9d. Per-viewer data stays uncached

`isOwner`, comment edit/delete permissions, and `isSaved` (from §§1-3)
are computed from `session` plus the per-user Blobs cache, layered onto
the cached shared payload at render time. None of it is baked into the
`recipe-detail:<id>` cache entry itself, which stays identical for
every viewer.

## Files touched

| File | Change |
|------|--------|
| `lib/user-state-cache.js` (new) | Blob read/write/hydrate helpers: get-or-hydrate a user's blob, mutate saved-ids, append/dedupe a notification, mark read, mark dirty |
| `app/recipes/[id]/page.jsx` | Read `isSaved` from cache instead of hardcoded `false`; resolve id/slug via the recipe index cache (§9a) instead of a live query; fetch detail payload via the per-recipe cache (§9b) |
| `app/recipes/search/route.js` | Read `isSaved` from cache instead of hardcoded `false`/filter-only; sort/filter/paginate the cached recipe index in memory instead of querying Postgres per request (§9a) |
| `app/recipes/save/route.js` | Rewrite toggle to mutate the cache + mark dirty instead of writing Postgres directly |
| `lib/recipe-saves.js` | Keep `toggleSavedRecipeForUser`/`getSaveCountForRecipe` for use by the flush job; no longer called from the live toggle route |
| `lib/notifications.js` | `notifyRecipeSaved` logic moves to cache-append (live path) + flush-time insert (reconciliation path); read-receipt functions gain a cache-aware counterpart |
| `app/api/notifications/route.js` | Serve from cache instead of DB |
| `app/api/notifications/read/route.js` | Update cache instead of DB |
| `components/NotificationBell.jsx` | Add unread badge + visibility-aware 45s polling |
| `netlify/functions/state-cache-flush.js` (new) | Hourly scheduled reconciliation job |
| `netlify.toml` | Add `[functions."state-cache-flush"]` esbuild bundler entry, matching `notification-digest` |
| `lib/public-recipe-catalog.js` | Add `getRecipeIndex()` (§9a); `fetchRecipeCatalog` stops being the per-request query path for the default/cached view |
| `lib/public-recipe-catalog-cache.js` | Add `recipeDetailTag(id)` and `revalidateRecipeDetail(recipeId)` (§9b/§9c) |
| `lib/comments.js` | `getCommentsForRecipe` folded into the per-recipe detail cache (§9b) instead of queried live per view |
| `lib/recipe-detail-cache.js` (new) | `fetchRecipeDetail(recipeId)` (settings + images + comments) and `getCachedRecipeDetail(recipeId)` (§9b) |
| `app/recipes/[id]/actions.js` | Add `revalidateRecipeDetail(recipeId)` alongside existing `revalidatePublicRecipeCatalog()` calls (comment add/delete, recipe update/delete, slug rename) |
| `app/upload/actions.js` | Add `revalidateRecipeDetail(recipeId)` alongside existing `revalidatePublicRecipeCatalog()` calls (sample-image add/set-primary) |
| `app/profile/actions.js` | Look up the author's recipe ids and call `revalidateRecipeDetail(id)` for each, alongside the existing catalog revalidation |
| `lib/privacy.js` | Same, for each recipe id deleted during account deletion |

## Testing

- **Unit (`lib/user-state-cache.js`):** hydrate-from-empty builds correct blob shape; toggle-save mutates and dedupes correctly; append-notification respects `dedupeKey`; mark-read updates only targeted entries.
- **Flush job:** reconciling a dirty user's saves matches a full set-diff (insert/delete both directions); re-running the same flush twice is a no-op the second time (idempotency); a notification already present in Postgres (piggyback got there first) doesn't duplicate via `onConflictDoNothing`.
- **Read path:** recipe detail/search route tests updated to assert `isSaved` reflects a seeded blob's `savedRecipeIds`, not always `false` (replacing the current `tests/recipe-detail-page.test.js:409` / `tests/recipe-search-route.test.js:188-193` assertions that codify the bug).
- **Toggle route:** save-then-save-again (idempotent double-save guard), save-then-immediate-unsave, verify no Postgres write occurs on the toggle request itself (mirroring the existing `db` query-logger pattern used to verify `getSession()`'s DB-free path).
- **Manual verification:** save a recipe, confirm the button stays correct across a reload before the next hourly flush; confirm the recipient's notification bell shows the save within 45s; confirm Neon's query log shows no activity between the hourly flush windows during a period of pure browsing/saving.
- **Recipe index/detail cache (§9):** viewing the same recipe twice issues one Postgres query, not two; commenting on recipe A busts only `recipe-detail:<A>`'s cache (a concurrently-cached recipe B's entry is untouched); scrolling the homepage grid through several pages of default sort issues at most one Postgres query for the whole session (not one per page); a slug-alias visit resolves via the cached index, not a live query; updating a profile's display name busts every one of that author's `recipe-detail:<id>` entries; deleting an account busts the cache for every recipe it deletes.

## Future work (explicitly out of scope here)

- Alerting/monitoring if the hourly flush job fails repeatedly and
  `pending/` entries pile up.
- True push delivery, if 45s polling ever feels insufficient.
- Extending the same blob-cache pattern to `modeSlotAssignments`
  (per-user mode-dial state), which has a similar read-heavy,
  write-light shape but is out of scope for this spec.
