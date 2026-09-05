# Stateless Session Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `getSession()`'s per-request database read with a signed cookie that verifies locally, so Neon's compute can actually scale to zero between real writes instead of staying awake on every logged-in page view.

**Architecture:** A new pure crypto module (`lib/auth-session-token.js`) signs and verifies a small JSON payload (`sid`, `uid`, `uuid`, `iat`, `exp`, `reval`) using HMAC-SHA256. `lib/auth.js`'s `getSession()` verifies that signature and checks expiry with no DB call; it only queries Postgres once a week per session (or on login/logout) to catch revocation. Nothing else about `authSessions`, magic links, or the DB schema changes. Consumers that used to read `session.author` or `session.user.email` (three account pages, the login page, one write action) now fetch that data directly by `session.user.id` instead.

**Tech Stack:** Next.js server components/actions, Drizzle ORM (`neon-http` driver — no transactions), `node:crypto` (`createHmac`, `timingSafeEqual` — no new dependency), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-04-stateless-sessions-design.md](../specs/2026-09-04-stateless-sessions-design.md)

## Global Constraints

- No database schema changes, no migration file. `authSessions`, `authMagicLinks`, `users`, `authors` are untouched.
- No new npm dependency. Signing uses `node:crypto` only.
- `SESSION_REVALIDATION_INTERVAL_MS` is exactly `7 * 24 * 60 * 60 * 1000` (one week).
- The signed cookie payload carries only `sid`, `uid`, `uuid`, `iat`, `exp`, `reval` — never `email`, never author data. (Spec scope decisions 4 and 5.)
- No ban/revocation feature is being added. The revalidation interval is a single named constant specifically so it can be tightened later — do not build anything beyond that constant for a future ban feature.
- `AUTH_SESSION_SIGNING_SECRET` is a new required env var. Without it set, every `getSession()`/`consumeMagicLink()` call throws. It must be set locally (`.env.local`) to run or test the app end-to-end, and set on Netlify's site configuration before this ships to production — that Netlify-side step is Ian's to do manually (same posture as DB migrations: generated/documented here, applied by Ian).
- Never commit to `main`; this work happens on a feature branch. Never push to remotes.

---

## Task 1: Cookie signing module

**Files:**
- Create: `lib/auth-session-token.js`
- Test: `tests/auth-session-token.test.js`

**Interfaces:**
- Produces: `signSessionPayload(payload: object): string`, `verifySessionCookie(cookieValue: string | null | undefined): object | null`, `SESSION_REVALIDATION_INTERVAL_MS: number`. Task 2's `lib/auth.js` rewrite imports all three from this module.

This module only handles signing/verifying an arbitrary JSON payload — it does not interpret `exp` or `reval` itself (that's `getSession()`'s job in Task 2, since expiry/revalidation policy belongs with session policy, not with the generic signing primitive).

- [ ] **Step 1: Write the failing test**

Create `tests/auth-session-token.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_REVALIDATION_INTERVAL_MS, signSessionPayload, verifySessionCookie } from '../lib/auth-session-token.js';

const ORIGINAL_SECRET = process.env.AUTH_SESSION_SIGNING_SECRET;
const samplePayload = { sid: 1, uid: 2, uuid: 'user-uuid', iat: 1000, exp: 2000, reval: 1000 };

describe('auth-session-token', () => {
    beforeEach(() => {
        process.env.AUTH_SESSION_SIGNING_SECRET = 'test-secret-value-not-real';
    });

    afterEach(() => {
        process.env.AUTH_SESSION_SIGNING_SECRET = ORIGINAL_SECRET;
    });

    it('round-trips a signed payload', () => {
        const cookie = signSessionPayload(samplePayload);
        expect(verifySessionCookie(cookie)).toEqual(samplePayload);
    });

    it('rejects a payload segment that has been tampered with', () => {
        const cookie = signSessionPayload(samplePayload);
        const signature = cookie.slice(cookie.lastIndexOf('.') + 1);
        const tamperedPayload = Buffer.from(JSON.stringify({ ...samplePayload, uid: 999 })).toString('base64url');

        expect(verifySessionCookie(`${tamperedPayload}.${signature}`)).toBeNull();
    });

    it('rejects a signature segment that has been tampered with', () => {
        const cookie = signSessionPayload(samplePayload);
        const payloadB64 = cookie.slice(0, cookie.lastIndexOf('.'));

        expect(verifySessionCookie(`${payloadB64}.not-a-real-signature`)).toBeNull();
    });

    it('rejects a cookie verified against a different secret than it was signed with', () => {
        const cookie = signSessionPayload(samplePayload);
        process.env.AUTH_SESSION_SIGNING_SECRET = 'a-completely-different-secret';

        expect(verifySessionCookie(cookie)).toBeNull();
    });

    it('rejects malformed or empty cookie values', () => {
        expect(verifySessionCookie('')).toBeNull();
        expect(verifySessionCookie(null)).toBeNull();
        expect(verifySessionCookie(undefined)).toBeNull();
        expect(verifySessionCookie('no-dot-here')).toBeNull();
        expect(verifySessionCookie('.')).toBeNull();
        expect(verifySessionCookie('somepayload.')).toBeNull();
    });

    it('exposes a one-week revalidation interval', () => {
        expect(SESSION_REVALIDATION_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth-session-token.test.js`
Expected: FAIL — `lib/auth-session-token.js` does not exist yet (module resolution error).

- [ ] **Step 3: Write the implementation**

Create `lib/auth-session-token.js`:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_REVALIDATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function requireSigningSecret() {
    const secret = process.env.AUTH_SESSION_SIGNING_SECRET;
    if (!secret) {
        throw new Error('AUTH_SESSION_SIGNING_SECRET is not set');
    }
    return secret;
}

function sign(payloadB64) {
    return createHmac('sha256', requireSigningSecret()).update(payloadB64).digest('base64url');
}

export function signSessionPayload(payload) {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionCookie(cookieValue) {
    if (typeof cookieValue !== 'string' || cookieValue.length === 0) return null;

    const separatorIndex = cookieValue.lastIndexOf('.');
    if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1) return null;

    const payloadB64 = cookieValue.slice(0, separatorIndex);
    const signatureB64 = cookieValue.slice(separatorIndex + 1);

    let expectedSignature;
    try {
        expectedSignature = sign(payloadB64);
    } catch {
        return null;
    }

    const expected = Buffer.from(expectedSignature, 'base64url');
    const actual = Buffer.from(signatureB64, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/auth-session-token.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth-session-token.js tests/auth-session-token.test.js
git commit -m "$(cat <<'EOF'
Add signed-cookie session token module

Pure sign/verify primitive for the stateless-session rewrite: HMAC-SHA256
over a JSON payload, base64url-encoded, using node:crypto only. Does not
interpret exp/reval itself — that's session policy, added in lib/auth.js.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Core session rewrite (`lib/auth.js`)

**Files:**
- Modify: `lib/auth.js` (full rewrite of `createSession`, `deleteSessionByToken` → `deleteSessionById`, `consumeMagicLink`, `touchSessionIfNeeded` → removed, `getSession`, `logoutCurrentSession`)
- Modify: `lib/auth-session-cookie.js` (remove unused `refreshSessionCookieIfPresent`)
- Modify: `app/auth/session/route.js` (drop `email`/`name` from the response — they no longer exist on the session)
- Modify: `tests/auth-routes.test.js` (update the mocked `getSession()` shape and the expected JSON response)
- Create: `tests/auth-session.test.js`
- Modify: `README.md` (document `AUTH_SESSION_SIGNING_SECRET`)
- Modify (local, not committed): `.env.local` — add `AUTH_SESSION_SIGNING_SECRET`

**Interfaces:**
- Consumes: `signSessionPayload`, `verifySessionCookie`, `SESSION_REVALIDATION_INTERVAL_MS` from `lib/auth-session-token.js` (Task 1).
- Produces: `getSession(): Promise<{ user: { id, uuid }, session: { id, expiresAt } } | null>` — **note this drops `author` and the `email`/`emailVerifiedAt`/`name` fields `user` used to carry.** `requireUser()` is unchanged in shape (still throws if `!session?.user`, still returns the full session object — now shaped as above). `logoutCurrentSession()` and `consumeMagicLink()` keep their existing external signatures (`consumeMagicLink({ token, ipAddress, userAgent }): Promise<{ redirectTo }>`). All later tasks (3–6) consume the new trimmed `session.user` shape.

**⚠️ After this task, `app/user/page.jsx`, `app/profile/page.jsx`, `app/upload/page.jsx`, and `app/login/page.jsx` read `session.author` / `session.user.email`, which no longer exist — they will render incorrectly (undefined values) until Tasks 3–4 fix them. `npm test` will still be green (nothing tests those pages directly), but do not deploy between this task and Task 4.** This is called out explicitly rather than silently left broken; it's an accepted, temporary, same-branch state.

- [ ] **Step 1: Set the env var locally**

`AUTH_SESSION_SIGNING_SECRET` must exist before any of this task's tests or manual runs will work (the module throws without it).

- [ ] Generate a secret and add it to `.env.local`:

```bash
echo "AUTH_SESSION_SIGNING_SECRET=$(openssl rand -base64 32)" >> .env.local
```

- [ ] Add the same line to `.env.local.dev` if that file is what `netlify dev` actually loads locally (check which of `.env.local` / `.env.local.dev` is in use in this environment — both exist in this repo).

- [ ] Document it in `README.md`, in the "Environment Notes" bullet list, right after `AUTH_COOKIE_DOMAIN`:

```diff
 - `APP_BASE_URL`
 - `NETLIFY_DATABASE_URL`
 - `NEXT_PUBLIC_GA4_MEASUREMENT_ID`
 - `AUTH_COOKIE_DOMAIN`
+- `AUTH_SESSION_SIGNING_SECRET` — signs the session cookie (`lib/auth-session-token.js`). Required; generate with `openssl rand -base64 32`. Rotating it signs everyone out.
 - `OCI_EMAIL_DELIVERY_ENDPOINT`
```

- [ ] **Note for Ian (not an automated step):** this also needs to be added to the Netlify site's environment variables before this branch is deployed, the same way any other production secret would be. Nothing in this plan does that for you.

- [ ] **Step 2: Write the failing tests**

Create `tests/auth-session.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTH_SESSION_COOKIE } from '../lib/auth-session-cookie.js';
import { signSessionPayload, verifySessionCookie } from '../lib/auth-session-token.js';

let cookieStore;
let selectMock;
let updateMock;
let insertMock;
let deleteMock;
let selectResponses;
let updateResponses;
let insertResponses;

vi.mock('next/headers', () => ({
    cookies: () => Promise.resolve(cookieStore)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args),
        insert: (...args) => insertMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

function createCookieStore(initialValue = null) {
    let currentValue = initialValue;
    return {
        get: vi.fn((name) => (name === AUTH_SESSION_COOKIE && currentValue != null ? { value: currentValue } : undefined)),
        set: vi.fn((name, value) => {
            currentValue = value === '' ? null : value;
        })
    };
}

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(() => Promise.resolve(result))
    };
}

// `where()` here must support both `.returning(...)` (magic-link consume, users
// update) and being awaited directly with no `.returning()` call (the
// revalidation expiry bump) — so the chain object itself is thenable.
function makeUpdateChain(returningResult) {
    const settled = Promise.resolve(returningResult ?? undefined);
    const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(() => chain),
        returning: vi.fn(() => Promise.resolve(returningResult ?? [])),
        then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected)
    };
    return chain;
}

function makeInsertChain(returningResult) {
    return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(() => Promise.resolve(returningResult))
    };
}

function makeDeleteChain() {
    return {
        where: vi.fn(() => Promise.resolve())
    };
}

const ORIGINAL_SECRET = process.env.AUTH_SESSION_SIGNING_SECRET;

describe('lib/auth.js session handling', () => {
    let getSession;
    let consumeMagicLink;
    let logoutCurrentSession;

    beforeEach(async () => {
        process.env.AUTH_SESSION_SIGNING_SECRET = 'test-secret-value-not-real';
        cookieStore = createCookieStore();
        selectResponses = [];
        updateResponses = [];
        insertResponses = [];
        selectMock = vi.fn(() => makeSelectChain(selectResponses.shift() ?? []));
        updateMock = vi.fn(() => makeUpdateChain(updateResponses.shift()));
        insertMock = vi.fn(() => makeInsertChain(insertResponses.shift()));
        deleteMock = vi.fn(() => makeDeleteChain());

        vi.resetModules();
        const mod = await import('../lib/auth.js');
        getSession = mod.getSession;
        consumeMagicLink = mod.consumeMagicLink;
        logoutCurrentSession = mod.logoutCurrentSession;
    });

    afterEach(() => {
        process.env.AUTH_SESSION_SIGNING_SECRET = ORIGINAL_SECRET;
        vi.restoreAllMocks();
    });

    describe('getSession', () => {
        it('returns null with no DB calls when there is no cookie', async () => {
            const result = await getSession();

            expect(result).toBeNull();
            expect(selectMock).not.toHaveBeenCalled();
            expect(cookieStore.set).not.toHaveBeenCalled();
        });

        it('clears the cookie and returns null for a cookie with an invalid signature', async () => {
            cookieStore = createCookieStore('garbage.not-a-real-signature');

            const result = await getSession();

            expect(result).toBeNull();
            expect(selectMock).not.toHaveBeenCalled();
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });

        it('clears the cookie and returns null for an expired session', async () => {
            const now = Date.now();
            const cookie = signSessionPayload({ sid: 1, uid: 2, uuid: 'user-uuid', iat: now - 1000, exp: now - 500, reval: now - 1000 });
            cookieStore = createCookieStore(cookie);

            const result = await getSession();

            expect(result).toBeNull();
            expect(selectMock).not.toHaveBeenCalled();
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });

        it('returns the session straight from the payload when revalidation is not due, with no DB calls', async () => {
            const now = Date.now();
            const exp = now + 13 * 24 * 60 * 60 * 1000;
            const cookie = signSessionPayload({
                sid: 5,
                uid: 7,
                uuid: 'user-uuid',
                iat: now - 60 * 60 * 1000,
                exp,
                reval: now - 60 * 60 * 1000 // 1 hour ago, well inside the 1-week window
            });
            cookieStore = createCookieStore(cookie);

            const result = await getSession();

            expect(result).toEqual({
                user: { id: 7, uuid: 'user-uuid' },
                session: { id: 5, expiresAt: new Date(exp) }
            });
            expect(selectMock).not.toHaveBeenCalled();
            expect(updateMock).not.toHaveBeenCalled();
            expect(cookieStore.set).not.toHaveBeenCalled();
        });

        it('revalidates against the DB, bumps the session, and reissues the cookie when the interval has passed', async () => {
            const now = Date.now();
            const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
            const cookie = signSessionPayload({
                sid: 5,
                uid: 7,
                uuid: 'old-uuid',
                iat: eightDaysAgo,
                exp: now + 6 * 24 * 60 * 60 * 1000,
                reval: eightDaysAgo
            });
            cookieStore = createCookieStore(cookie);
            selectResponses = [[{ sessionId: 5, userId: 7, userUuid: 'old-uuid' }]];

            const result = await getSession();

            expect(result).toEqual({
                user: { id: 7, uuid: 'old-uuid' },
                session: { id: 5, expiresAt: expect.any(Date) }
            });
            expect(selectMock).toHaveBeenCalledTimes(1);
            expect(updateMock).toHaveBeenCalledTimes(1);

            const [, newCookieValue] = cookieStore.set.mock.calls.at(-1);
            const newPayload = verifySessionCookie(newCookieValue);
            expect(newPayload).toMatchObject({ sid: 5, uid: 7, uuid: 'old-uuid' });
            expect(newPayload.reval).toBeGreaterThan(eightDaysAgo);
        });

        it('clears the cookie and returns null when revalidation finds no matching session row', async () => {
            const now = Date.now();
            const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
            const cookie = signSessionPayload({
                sid: 5,
                uid: 7,
                uuid: 'old-uuid',
                iat: eightDaysAgo,
                exp: now + 6 * 24 * 60 * 60 * 1000,
                reval: eightDaysAgo
            });
            cookieStore = createCookieStore(cookie);
            selectResponses = [[]];

            const result = await getSession();

            expect(result).toBeNull();
            expect(updateMock).not.toHaveBeenCalled();
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });
    });

    describe('logoutCurrentSession', () => {
        it('deletes the session row by id and clears the cookie', async () => {
            const cookie = signSessionPayload({ sid: 42, uid: 1, uuid: 'u', iat: 1, exp: Date.now() + 100000, reval: 1 });
            cookieStore = createCookieStore(cookie);

            await logoutCurrentSession();

            expect(deleteMock).toHaveBeenCalledTimes(1);
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });

        it('clears the cookie without deleting anything when there is no cookie', async () => {
            await logoutCurrentSession();

            expect(deleteMock).not.toHaveBeenCalled();
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });

        it('clears the cookie without deleting anything when the cookie fails to verify', async () => {
            cookieStore = createCookieStore('garbage.not-a-real-signature');

            await logoutCurrentSession();

            expect(deleteMock).not.toHaveBeenCalled();
            expect(cookieStore.set).toHaveBeenCalledWith(AUTH_SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
        });
    });

    describe('consumeMagicLink', () => {
        it('creates a session and sets a validly signed cookie carrying the new session identity', async () => {
            selectResponses = [
                [{ id: 1, userId: 7, redirectTo: '/profile', expiresAt: new Date(Date.now() + 60000), consumedAt: null }]
            ];
            updateResponses = [[{ id: 1 }], [{ id: 7, uuid: 'user-uuid-abc' }]];
            insertResponses = [[{ id: 55 }]];

            const result = await consumeMagicLink({ token: 'raw-token-value', ipAddress: '1.2.3.4', userAgent: 'test-agent' });

            expect(result).toEqual({ redirectTo: '/profile' });
            expect(cookieStore.set).toHaveBeenCalledTimes(1);

            const [, cookieValue] = cookieStore.set.mock.calls[0];
            const payload = verifySessionCookie(cookieValue);
            expect(payload).toMatchObject({ sid: 55, uid: 7, uuid: 'user-uuid-abc' });
            expect(payload.reval).toBe(payload.iat);
            expect(payload.exp).toBeGreaterThan(payload.iat);
        });
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/auth-session.test.js`
Expected: FAIL — `lib/auth.js` still has the old token-based `getSession()`/`consumeMagicLink()`/`logoutCurrentSession()`, so behavior and cookie shape won't match.

- [ ] **Step 4: Rewrite `lib/auth.js`**

Replace the entire file content with:

```js
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authMagicLinks, authSessions, authors, users } from '../db/schema.ts';
import {
    AUTH_SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    sessionCookieBaseOptions,
    sessionCookieOptions
} from './auth-session-cookie.js';
import { signSessionPayload, verifySessionCookie, SESSION_REVALIDATION_INTERVAL_MS } from './auth-session-token.js';
import { publicAppBaseUrl } from './auth-url.js';
export { normalizeRedirectPath } from './redirect-path.js';
import { normalizeRedirectPath } from './redirect-path.js';

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const MAGIC_LINK_MAX_AGE_MS = 20 * 60 * 1000;

function nowPlus(ms) {
    return new Date(Date.now() + ms);
}

function hashToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
    return randomBytes(32).toString('base64url');
}

export function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function defaultDisplayNameFromEmail(email) {
    const localPart = normalizeEmail(email).split('@')[0] ?? '';
    const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
    return cleaned || 'OM Recipes author';
}

async function setSessionCookie(token, expiresAt) {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_SESSION_COOKIE, '', {
        ...sessionCookieBaseOptions(),
        expires: new Date(0),
        maxAge: 0
    });
}

async function safeSetSessionCookie(token, expiresAt) {
    try {
        await setSessionCookie(token, expiresAt);
    } catch {
        // Server component renders cannot always mutate cookies.
    }
}

async function safeClearSessionCookie() {
    try {
        await clearSessionCookie();
    } catch {
        // Server component renders cannot always mutate cookies.
    }
}

async function getSessionTokenFromCookies() {
    const cookieStore = await cookies();
    return cookieStore.get(AUTH_SESSION_COOKIE)?.value ?? null;
}

async function findOrCreateUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email);

    const existing = await db
        .select({
            id: users.id,
            uuid: users.uuid,
            email: users.email
        })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

    if (existing.length > 0) {
        return existing[0];
    }

    const created = await db
        .insert(users)
        .values({
            email: normalizedEmail
        })
        .returning({
            id: users.id,
            uuid: users.uuid,
            email: users.email
        });

    return created[0];
}

export async function findOrCreateAuthorForUser({ userId, email, displayName }) {
    const existing = await db
        .select({
            id: authors.id,
            uuid: authors.uuid,
            name: authors.name
        })
        .from(authors)
        .where(eq(authors.userId, userId))
        .orderBy(asc(authors.id))
        .limit(1);

    if (existing.length > 0) {
        return existing[0];
    }

    const created = await db
        .insert(authors)
        .values({
            userId,
            name: String(displayName ?? '').trim() || defaultDisplayNameFromEmail(email)
        })
        .returning({
            id: authors.id,
            uuid: authors.uuid,
            name: authors.name
        });

    return created[0];
}

async function createMagicLink({ email, redirectTo, requestedIp, requestedUserAgent }) {
    const user = await findOrCreateUserByEmail(email);
    const token = newToken();

    await db.insert(authMagicLinks).values({
        userId: user.id,
        tokenHash: hashToken(token),
        redirectTo: normalizeRedirectPath(redirectTo, '/profile'),
        requestedIp: requestedIp || null,
        requestedUserAgent: requestedUserAgent || null,
        expiresAt: nowPlus(MAGIC_LINK_MAX_AGE_MS)
    });

    return { token, user };
}

async function createSession({ userId, ipAddress, userAgent }) {
    // authSessions.tokenHash is NOT NULL with a unique index; this placeholder
    // token satisfies that constraint but is no longer the read-path lookup
    // key — sessions are found by id (sid) once verified via the signed cookie.
    const placeholderToken = newToken();
    const expiresAt = nowPlus(SESSION_MAX_AGE_MS);

    const [row] = await db
        .insert(authSessions)
        .values({
            userId,
            tokenHash: hashToken(placeholderToken),
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
            expiresAt,
            lastSeenAt: new Date()
        })
        .returning({ id: authSessions.id });

    return { sessionId: row.id, expiresAt };
}

async function deleteSessionById(sessionId) {
    if (!sessionId) return;
    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

function buildMagicLinkEmail({ magicLinkUrl, redirectTo }) {
    const safeRedirect = normalizeRedirectPath(redirectTo, '/profile');
    return {
        subject: 'Your OM Recipes sign-in link',
        text: `Use this link to sign in to OM Recipes: ${magicLinkUrl}\n\nThis link expires in 20 minutes.\n\nAfter sign-in you will land on ${safeRedirect}.`,
        html: `<p>Use this link to sign in to OM Recipes:</p><p><a href="${magicLinkUrl}">Sign in to OM Recipes</a></p><p>This link expires in 20 minutes.</p>`
    };
}

export async function sendMagicLinkEmail({
    email,
    baseUrl,
    redirectTo,
    requestedIp,
    requestedUserAgent
}) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
        throw new Error('Please enter a valid email address');
    }

    const { token } = await createMagicLink({
        email: normalizedEmail,
        redirectTo,
        requestedIp,
        requestedUserAgent
    });

    const magicLinkUrl = `${publicAppBaseUrl(baseUrl)}/auth/verify?token=${encodeURIComponent(token)}`;
    const emailPayload = buildMagicLinkEmail({
        magicLinkUrl,
        redirectTo
    });

    const { sendEmail } = await import('./oci/emailDelivery.js');
    await sendEmail({
        to: normalizedEmail,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text
    });
}

export async function consumeMagicLink({ token, ipAddress, userAgent }) {
    const tokenHash = hashToken(token);
    const now = new Date();

    const rows = await db
        .select({
            id: authMagicLinks.id,
            userId: authMagicLinks.userId,
            redirectTo: authMagicLinks.redirectTo,
            expiresAt: authMagicLinks.expiresAt,
            consumedAt: authMagicLinks.consumedAt
        })
        .from(authMagicLinks)
        .where(eq(authMagicLinks.tokenHash, tokenHash))
        .limit(1);

    if (rows.length === 0) {
        throw new Error('This sign-in link is invalid or has already been used');
    }

    const link = rows[0];
    if (link.consumedAt || link.expiresAt < now) {
        throw new Error('This sign-in link has expired or has already been used');
    }

    const consumed = await db
        .update(authMagicLinks)
        .set({ consumedAt: now })
        .where(and(eq(authMagicLinks.id, link.id), isNull(authMagicLinks.consumedAt), eq(authMagicLinks.tokenHash, tokenHash)))
        .returning({ id: authMagicLinks.id });

    if (consumed.length === 0) {
        throw new Error('This sign-in link is invalid or has already been used');
    }

    const [updatedUser] = await db
        .update(users)
        .set({
            emailVerifiedAt: now,
            updatedAt: now
        })
        .where(eq(users.id, link.userId))
        .returning({ id: users.id, uuid: users.uuid });

    const { sessionId, expiresAt } = await createSession({
        userId: updatedUser.id,
        ipAddress,
        userAgent
    });

    const issuedAt = Date.now();
    await setSessionCookie(
        signSessionPayload({
            sid: sessionId,
            uid: updatedUser.id,
            uuid: updatedUser.uuid,
            iat: issuedAt,
            exp: expiresAt.getTime(),
            reval: issuedAt
        }),
        expiresAt
    );

    return {
        redirectTo: normalizeRedirectPath(link.redirectTo, '/profile')
    };
}

export async function getSession() {
    const token = await getSessionTokenFromCookies();
    if (!token) return null;

    const payload = verifySessionCookie(token);
    if (!payload) {
        await safeClearSessionCookie();
        return null;
    }

    const now = Date.now();
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
        await safeClearSessionCookie();
        return null;
    }

    if (typeof payload.reval === 'number' && now - payload.reval < SESSION_REVALIDATION_INTERVAL_MS) {
        return {
            user: { id: payload.uid, uuid: payload.uuid },
            session: { id: payload.sid, expiresAt: new Date(payload.exp) }
        };
    }

    const rows = await db
        .select({
            sessionId: authSessions.id,
            userId: users.id,
            userUuid: users.uuid
        })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(
            and(
                eq(authSessions.id, payload.sid),
                isNull(authSessions.revokedAt),
                gt(authSessions.expiresAt, new Date(now))
            )
        )
        .limit(1);

    if (rows.length === 0) {
        await safeClearSessionCookie();
        return null;
    }

    const row = rows[0];
    const refreshedExpiresAt = nowPlus(SESSION_MAX_AGE_MS);

    await db
        .update(authSessions)
        .set({
            expiresAt: refreshedExpiresAt,
            lastSeenAt: new Date(now)
        })
        .where(eq(authSessions.id, row.sessionId));

    const refreshedAt = Date.now();
    await safeSetSessionCookie(
        signSessionPayload({
            sid: row.sessionId,
            uid: row.userId,
            uuid: row.userUuid,
            iat: refreshedAt,
            exp: refreshedExpiresAt.getTime(),
            reval: refreshedAt
        }),
        refreshedExpiresAt
    );

    return {
        user: { id: row.userId, uuid: row.userUuid },
        session: { id: row.sessionId, expiresAt: refreshedExpiresAt }
    };
}

export async function requireUser() {
    const session = await getSession();
    if (!session?.user) {
        throw new Error('Not authenticated');
    }
    return session;
}

export async function logoutCurrentSession() {
    const token = await getSessionTokenFromCookies();
    if (token) {
        const payload = verifySessionCookie(token);
        if (payload?.sid) {
            await deleteSessionById(payload.sid);
        }
    }
    await clearSessionCookie();
}
```

- [ ] **Step 5: Remove dead code from `lib/auth-session-cookie.js`**

Delete the `refreshSessionCookieIfPresent` export (no callers anywhere in the repo — confirmed during spec review):

```diff
 export function sessionCookieOptions(expiresAt = nowPlus(SESSION_MAX_AGE_MS)) {
     return {
         ...sessionCookieBaseOptions(),
         expires: expiresAt,
         maxAge: SESSION_MAX_AGE_SECONDS
     };
 }
-
-export function refreshSessionCookieIfPresent(request, response) {
-    const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
-    if (!token) return response;
-
-    response.cookies.set(AUTH_SESSION_COOKIE, token, sessionCookieOptions());
-    return response;
-}
```

- [ ] **Step 6: Run the new tests, verify they pass**

Run: `npx vitest run tests/auth-session.test.js`
Expected: PASS (10 tests: 6 `getSession`, 3 `logoutCurrentSession`, 1 `consumeMagicLink`).

- [ ] **Step 7: Update `app/auth/session/route.js`**

`session.user` no longer has `email` or `name`; drop both from the response (the only caller, `components/HeaderNav.jsx`, only checks `Boolean(session?.user)` and never reads them):

```diff
     return Response.json(
         {
             user: session?.user
                 ? {
                     id: session.user.id,
-                    uuid: session.user.uuid,
-                    email: session.user.email,
-                    name: session.user.name
+                    uuid: session.user.uuid
                 }
                 : null
         },
```

- [ ] **Step 8: Update `tests/auth-routes.test.js`**

The "returns a trimmed user payload" test mocks `getSession()`'s old shape and asserts the old response shape. Update both:

```diff
     it('returns a trimmed user payload for authenticated users', async () => {
         vi.mocked(getSession).mockResolvedValue({
             user: {
                 id: 42,
-                uuid: 'user-uuid',
-                email: 'ian@example.com',
-                name: 'Ian',
-                emailVerifiedAt: new Date('2026-04-23T00:00:00Z')
+                uuid: 'user-uuid'
             },
-            author: null,
             session: {
                 id: 99,
                 expiresAt: new Date('2026-05-01T00:00:00Z')
             }
         });

         const response = await sessionRouteGet();

         await expect(response.json()).resolves.toEqual({
             user: {
                 id: 42,
-                uuid: 'user-uuid',
-                email: 'ian@example.com',
-                name: 'Ian'
+                uuid: 'user-uuid'
             }
         });
     });
```

- [ ] **Step 9: Run both affected test files**

Run: `npx vitest run tests/auth-routes.test.js tests/auth-session.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS. (If anything outside these two files fails, stop and investigate before continuing — it means something else depended on the old `getSession()` shape that wasn't caught by the file-by-file greps done during spec review.)

- [ ] **Step 11: Commit**

```bash
git add lib/auth.js lib/auth-session-cookie.js app/auth/session/route.js tests/auth-routes.test.js tests/auth-session.test.js README.md
git commit -m "$(cat <<'EOF'
Rewrite getSession() to verify a signed cookie instead of reading the DB

getSession() now verifies the session cookie's HMAC signature and expiry
locally, with no DB call, for every request within the 1-week
revalidation window. Postgres is only touched on login, logout, and
once-a-week revalidation per session. session.user drops to { id, uuid }
— author data and email were already unused on the cost-driving read
path (see the design spec) and now live only in the callers that
actually need them (Tasks 3-6).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Note: `.env.local` is gitignored (see `.gitignore`) and is deliberately not in the `git add` list above — do not add it. Naming an explicitly-ignored path in `git add` aborts the whole command (stages nothing at all, not even the other files), so it must stay out of the command entirely rather than rely on git to skip just that one path. Only the `README.md` documentation of the variable should actually be committed.

---

## Task 3: Account pages — fetch author/email directly

**Files:**
- Modify: `app/user/page.jsx`
- Modify: `app/profile/page.jsx`
- Modify: `app/upload/page.jsx`

**Interfaces:**
- Consumes: `getSession()` → `{ user: { id, uuid } }` (Task 2), `defaultDisplayNameFromEmail(email: string): string` (unchanged export from `lib/auth.js`), `db`, `eq`, the `users`/`authors` Drizzle tables.

No test changes — none of these three page components has existing automated coverage (confirmed: no `tests/*.test.js` references `app/user/page.jsx`, `app/profile/page.jsx`, or `app/upload/page.jsx`). Verification for this task is manual (Step 5, after all three files are edited).

- [ ] **Step 1: Rewrite `app/user/page.jsx`**

```jsx
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { authors, users } from '../../db/schema.ts';
import { defaultDisplayNameFromEmail, getSession } from '../../lib/auth.js';

export default async function Page() {
    const session = await getSession();
    const user = session?.user;

    if (!user) {
        return (
            <div className="max-w-xl py-12">
                <h1 className="mb-4">User</h1>
                <p className="mb-6">You’re not signed in.</p>
                <Link href="/login?redirectTo=%2Fuser" className="btn">
                    Log In
                </Link>
            </div>
        );
    }

    const [row] = await db
        .select({
            email: users.email,
            authorUuid: authors.uuid,
            authorName: authors.name
        })
        .from(users)
        .leftJoin(authors, eq(authors.userId, users.id))
        .where(eq(users.id, user.id))
        .limit(1);

    return (
        <div className="max-w-xl py-12">
            <h1 className="mb-4">User</h1>
            <div className="action-card">
                <p>Email: {row?.email}</p>
                <p>Name: {row?.authorName ?? defaultDisplayNameFromEmail(row?.email)}</p>
                <p>Author UUID: {row?.authorUuid ?? 'Not created yet'}</p>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Update `app/profile/page.jsx`**

```diff
 import Link from 'next/link';
+import { eq } from 'drizzle-orm';
 import { Button, buttonVariants } from 'components/ui/button';
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
-import { getSession } from '../../lib/auth.js';
+import { db } from '../../db/index.ts';
+import { authors, users } from '../../db/schema.ts';
+import { defaultDisplayNameFromEmail, getSession } from '../../lib/auth.js';
 import { getEffectivePreferences } from '../../lib/notifications.js';
 import { listPrivacyRequestsForUser, PRIVACY_REQUEST_STATUS_COMPLETED, PRIVACY_REQUEST_TYPE_EXPORT } from '../../lib/privacy.js';
 import { deleteMyAccountAction, requestMyDataExportAction, updateMyNotificationPreferencesAction, updateMyProfileAction } from './actions';
 import { NotificationPreferencesForm } from './notifications-form';
 import { ProfileForm } from './profile-form';

 export const metadata = {
     title: 'Profile'
 };

 export default async function Page() {
     const session = await getSession();
     const user = session?.user;
-    const author = session?.author;

     if (!user) {
         return (
             <Card className="max-w-xl">
                 <CardHeader>
                     <CardTitle>Profile</CardTitle>
                     <CardDescription>Please log in to edit your profile.</CardDescription>
                 </CardHeader>
                 <CardContent>
                 <Link href="/login?redirectTo=%2Fprofile" className={buttonVariants()}>
                     Log in
                 </Link>
                 </CardContent>
             </Card>
         );
     }

+    const [row] = await db
+        .select({
+            email: users.email,
+            authorName: authors.name,
+            instagramLink: authors.instagramLink,
+            flickrLink: authors.flickrLink,
+            website: authors.website,
+            kofiLink: authors.kofiLink
+        })
+        .from(users)
+        .leftJoin(authors, eq(authors.userId, users.id))
+        .where(eq(users.id, user.id))
+        .limit(1);
+
     const privacyRequests = await listPrivacyRequestsForUser(user.id);
     const notificationPreferences = await getEffectivePreferences(user.id);
```

And further down, the `ProfileForm` default values:

```diff
                     <ProfileForm
                         action={updateMyProfileAction}
                         initialValues={{
-                            name: author?.name ?? user.name ?? '',
-                            instagramLink: author?.instagramLink ?? '',
-                            flickrLink: author?.flickrLink ?? '',
-                            website: author?.website ?? '',
-                            kofiLink: author?.kofiLink ?? ''
+                            name: row?.authorName ?? defaultDisplayNameFromEmail(row?.email),
+                            instagramLink: row?.instagramLink ?? '',
+                            flickrLink: row?.flickrLink ?? '',
+                            website: row?.website ?? '',
+                            kofiLink: row?.kofiLink ?? ''
                         }}
                     />
```

- [ ] **Step 3: Update `app/upload/page.jsx`**

```diff
 import { after } from 'next/server';
+import { eq } from 'drizzle-orm';
 import { uploadDisabled } from 'utils';
 import { Alert } from 'components/alert';
 import { Markdown } from 'components/markdown';
 import RecipeUpload from './RecipeUpload';
-import { getSession } from '../../lib/auth.js';
+import { db } from '../../db/index.ts';
+import { authors, users } from '../../db/schema.ts';
+import { defaultDisplayNameFromEmail, getSession } from '../../lib/auth.js';
 import { warmImageResizeFunction } from '../../lib/oci/functionsInvoke.js';
 import LoginButton from 'components/LoginButton';
 import { Badge } from 'components/ui/badge';
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
```

```diff
 export default async function Page() {
     const session = await getSession();
     const user = session?.user;

     if (user) {
         after(() => warmImageResizeFunction().catch(() => {}));
     }

+    let initialAuthor = '';
+    if (user) {
+        const [row] = await db
+            .select({ email: users.email, authorName: authors.name })
+            .from(users)
+            .leftJoin(authors, eq(authors.userId, users.id))
+            .where(eq(users.id, user.id))
+            .limit(1);
+        initialAuthor = row?.authorName ?? defaultDisplayNameFromEmail(row?.email) ?? '';
+    }
+
     return (
```

```diff
                     {user ? (
-                        <RecipeUpload initialAuthor={session?.author?.name ?? user?.name ?? ''} />
+                        <RecipeUpload initialAuthor={initialAuthor} />
                     ) : (
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (these files have no dedicated tests, so this run is a regression check on everything else — it should be unaffected).

- [ ] **Step 5: Manual verification**

Start the dev server (`netlify dev`, per `README.md`) and, while logged in as a user with no author row yet, then as one with an author row:

1. Visit `/user` — email, a name (derived-from-email if no author yet, otherwise the author name), and either "Not created yet" or a real author UUID all render.
2. Visit `/profile` — the "Profile" form's Name field is pre-filled the same way; Instagram/Flickr/website/Ko-fi fields are pre-filled from the author row if one exists, blank otherwise.
3. Visit `/upload` — the recipe upload form's author name field is pre-filled the same way.

- [ ] **Step 6: Commit**

```bash
git add app/user/page.jsx app/profile/page.jsx app/upload/page.jsx
git commit -m "$(cat <<'EOF'
Fetch author/email directly on the three pages that need them

session.author and session.user.email no longer exist after the
stateless-session rewrite. These are the only three page renders that
read them, and none is the cost-driving route, so each now runs one
users+authors join query instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Login page — fetch email directly

**Files:**
- Modify: `app/login/page.jsx`

**Interfaces:**
- Consumes: `getSession()` → `{ user: { id, uuid } }` (Task 2), `db`, `eq`, the `users` Drizzle table.

No existing test covers this page. Verification is manual.

- [ ] **Step 1: Update `app/login/page.jsx`**

```diff
 import Link from 'next/link';
+import { eq } from 'drizzle-orm';
 import { Alert } from 'components/alert';
 import { Button, buttonVariants } from 'components/ui/button';
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
 import { Input } from 'components/ui/input';
+import { db } from '../../db/index.ts';
+import { users } from '../../db/schema.ts';
 import { getSession, normalizeRedirectPath } from '../../lib/auth.js';
```

```diff
     if (session?.user) {
+        const [row] = await db
+            .select({ email: users.email })
+            .from(users)
+            .where(eq(users.id, session.user.id))
+            .limit(1);
+
         return (
             <Card className="max-w-xl">
                 <CardHeader>
                     <CardTitle>Log In</CardTitle>
-                    <CardDescription>You’re already signed in as {session.user.email}.</CardDescription>
+                    <CardDescription>You’re already signed in as {row?.email}.</CardDescription>
                 </CardHeader>
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual verification**

While logged in, visit `/login` directly — it should show "You're already signed in as `<your email>`." instead of a sign-in form.

- [ ] **Step 4: Commit**

```bash
git add app/login/page.jsx
git commit -m "$(cat <<'EOF'
Fetch email directly on the login page's already-signed-in view

session.user.email no longer exists after the stateless-session
rewrite; this is the only remaining reader of it outside a couple of
write actions (Tasks 5-6).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Drop the dead `email` argument in two write actions

**Files:**
- Modify: `app/profile/actions.js`
- Modify: `app/upload/actions.js`

**Interfaces:**
- No interface changes — `findOrCreateAuthorForUser({ userId, displayName })` (dropping the always-present-but-unused `email` argument at these two call sites; `email` remains a valid optional parameter of `findOrCreateAuthorForUser` itself, still used by Task 6).

Both of these were already dead reads of `session.user.email`, confirmed while writing this plan:
- `app/profile/actions.js`'s `updateMyProfileAction` throws before this call if `name` is blank, so `findOrCreateAuthorForUser`'s `email`-fallback branch (`String(displayName ?? '').trim() || defaultDisplayNameFromEmail(email)`) can never trigger.
- `app/upload/actions.js`'s `prepareRecipeUploadAction` has the identical guard (`isBlank(author)` at line 615, `'Author Name is required'`) before this call, so its `email`-fallback branch can never trigger either.

No test asserts the `email` argument on either call (confirmed: neither `tests/prepare-recipe-upload.test.js` nor any other test file asserts `findOrCreateAuthorForUserMock`'s call arguments for these two call sites), so no test changes are needed.

- [ ] **Step 1: Update `app/profile/actions.js`**

```diff
     const author = await findOrCreateAuthorForUser({
         userId: session.user.id,
-        email: session.user.email,
         displayName: name
     });
```

- [ ] **Step 2: Update `app/upload/actions.js`**

```diff
         const authorRow = await findOrCreateAuthorForUser({
             userId: session.user.id,
-            email: session.user.email,
             displayName: author
         });
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (unchanged — these calls were never asserted on).

- [ ] **Step 4: Commit**

```bash
git add app/profile/actions.js app/upload/actions.js
git commit -m "$(cat <<'EOF'
Stop passing email to findOrCreateAuthorForUser where it was already dead

Both call sites always pass a non-blank displayName (guarded earlier in
each action), so findOrCreateAuthorForUser's email-fallback branch could
never trigger here. Removing it also means session.user.email no longer
needs to exist for these two write actions to work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Comment action — fetch email for the one real remaining use

**Files:**
- Modify: `app/recipes/[id]/actions.js`
- Modify: `tests/recipe-comment-actions.test.js`

**Interfaces:**
- Consumes: `requireUser()` → `{ user: { id, uuid } }` (Task 2), `db`, `eq`, the `users` Drizzle table (new import).

Unlike Task 5's two call sites, `addCommentAction` passes **no** `displayName` to `findOrCreateAuthorForUser` at all — for a first-time commenter with no author row yet, `email` is the only name source, and it's a genuinely live path.

- [ ] **Step 1: Update the failing test first**

In `tests/recipe-comment-actions.test.js`, `requireUser`'s mock currently returns an `email` field that will no longer be read from the session — and the recipe-lookup `selectMock` needs a second queued response for the new email lookup:

```diff
 vi.mock('../lib/auth.js', () => ({
-    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } }),
+    requireUser: () => Promise.resolve({ user: { id: 9 } }),
     findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args)
 }));
```

```diff
-        const recipeSelectResponses = [[{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug' }]];
+        const recipeSelectResponses = [
+            [{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug' }],
+            [{ email: 'user@example.com' }]
+        ];
         selectMock = vi.fn(() => {
             const res = recipeSelectResponses.shift() ?? [];
             return {
                 from: vi.fn().mockReturnThis(),
                 where: vi.fn().mockReturnThis(),
                 limit: vi.fn(() => Promise.resolve(res))
             };
         });
```

The existing assertion at the bottom of that test (`expect(findOrCreateAuthorForUserMock).toHaveBeenCalledWith({ userId: 9, email: 'user@example.com' })`) does not need to change — the queried email still resolves to the same string.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-comment-actions.test.js`
Expected: FAIL — `addCommentAction` still reads `session.user.email` directly (which is now `undefined`), so `findOrCreateAuthorForUserMock` is called with `email: undefined` instead of `'user@example.com'`.

- [ ] **Step 3: Update `app/recipes/[id]/actions.js`**

```diff
 import { db } from '../../../db/index.ts';
 import {
     authors,
     comments,
     recipeColorSettings,
     recipeComparisonImages,
     recipeMonoSettings,
     recipeSampleImages,
-    recipes
+    recipes,
+    users
 } from '../../../db/schema.ts';
```

```diff
     const recipeRows = await db
         .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug })
         .from(recipes)
         .where(eq(recipes.id, parsedRecipeId))
         .limit(1);
     if (recipeRows.length === 0) throw new Error('Recipe not found');
     const recipe = recipeRows[0];

-    const author = await findOrCreateAuthorForUser({ userId: session.user.id, email: session.user.email });
+    const userRows = await db
+        .select({ email: users.email })
+        .from(users)
+        .where(eq(users.id, session.user.id))
+        .limit(1);
+
+    const author = await findOrCreateAuthorForUser({ userId: session.user.id, email: userRows[0]?.email });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-comment-actions.test.js`
Expected: PASS (6 tests, both `describe` blocks).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/recipes/\[id\]/actions.js tests/recipe-comment-actions.test.js
git commit -m "$(cat <<'EOF'
Fetch email directly in the comment action's author-creation fallback

session.user.email no longer exists. Unlike the two call sites fixed in
the previous commit, addCommentAction passes no displayName at all, so
email is the only name source for a first-time commenter — this is the
one real remaining use, confirmed while writing the implementation plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end manual verification

**Files:** none (verification only).

This is the spec's holistic check (§Testing): confirm the actual cost-driving path — a logged-in user viewing recipe pages — no longer touches the database on ordinary page views.

- [ ] **Step 1:** Start the dev server: `netlify dev` (per `README.md`).

- [ ] **Step 2:** Log in via the magic-link flow (or however login is normally exercised locally).

- [ ] **Step 3:** Add temporary logging around `db.select`/`db.update` calls (e.g. a one-line `console.log` in `db/index.ts`'s exported `db`, or watch Neon's own query log/dashboard if available), then:
   - Load `/recipes/<some-slug>` several times in a row.
   - Confirm no DB query fires from `getSession()` on those repeated loads (only whatever the recipe page itself queries for the recipe content — unrelated to this change).

- [ ] **Step 4:** Remove any temporary logging added for Step 3.

- [ ] **Step 5:** Exercise the write paths once each to confirm they still work end-to-end: log out, log back in (magic link), post a comment on a recipe, edit the profile form, upload a recipe (if feasible locally).

- [ ] **Step 6:** No commit for this task — it's verification only. If anything fails, go back to the relevant task, fix it there, and re-commit.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-04-stateless-sessions.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
