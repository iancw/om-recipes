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
