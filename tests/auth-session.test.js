import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
let reconcileUserStateBestEffortMock;

vi.mock('next/headers', () => ({
    cookies: () => Promise.resolve(cookieStore)
}));

vi.mock('../lib/user-state-flush.js', () => ({
    reconcileUserStateBestEffort: (...args) => reconcileUserStateBestEffortMock(...args)
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
        reconcileUserStateBestEffortMock = vi.fn(() => Promise.resolve());

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
            expect(reconcileUserStateBestEffortMock).toHaveBeenCalledWith('user-uuid-abc');
        });
    });
});
