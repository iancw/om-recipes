import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

vi.mock('../lib/auth.js', () => ({
    consumeMagicLink: vi.fn(),
    getSession: vi.fn(),
    logoutCurrentSession: vi.fn(),
    normalizeRedirectPath: vi.fn((value, fallback = '/') => {
        const candidate = String(value ?? '').trim();
        if (!candidate.startsWith('/')) return fallback;
        if (candidate.startsWith('//')) return fallback;
        return candidate;
    })
}));

import { consumeMagicLink, getSession, logoutCurrentSession } from '../lib/auth.js';
import { GET as verifyRouteGet } from '../app/auth/verify/route.js';
import { GET as logoutRouteGet, POST as logoutRoutePost } from '../app/auth/logout/route.js';
import { GET as sessionRouteGet } from '../app/auth/session/route.js';

const ORIGINAL_ENV = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
    NODE_ENV: process.env.NODE_ENV
};

describe('auth route cookies', () => {
    beforeEach(() => {
        process.env.APP_BASE_URL = 'https://www.omrecipes.dev';
        process.env.NODE_ENV = 'production';
        delete process.env.AUTH_COOKIE_DOMAIN;
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.env.APP_BASE_URL = ORIGINAL_ENV.APP_BASE_URL;
        process.env.AUTH_COOKIE_DOMAIN = ORIGINAL_ENV.AUTH_COOKIE_DOMAIN;
        process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
    });

    it('sets the session cookie on the verify redirect response', async () => {
        vi.mocked(consumeMagicLink).mockResolvedValue({
            redirectTo: '/profile'
        });

        const response = await verifyRouteGet(
            new NextRequest('https://deploy-preview-123--om-recipes.netlify.app/auth/verify?token=magic-token')
        );

        expect(consumeMagicLink).toHaveBeenCalledWith({
            token: 'magic-token',
            ipAddress: null,
            userAgent: null
        });
        expect(response.headers.get('location')).toBe('https://www.omrecipes.dev/profile');
    });

    it('does not clear the session cookie on logout GET requests', async () => {
        const response = await logoutRouteGet(new NextRequest('https://www.omrecipes.dev/auth/logout?returnTo=%2Flogin'));

        expect(logoutCurrentSession).not.toHaveBeenCalled();
        expect(response.headers.get('location')).toBe('https://www.omrecipes.dev/login');
        expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('clears the session cookie on logout POST requests', async () => {
        const request = new NextRequest('https://www.omrecipes.dev/auth/logout', {
            method: 'POST',
            body: new URLSearchParams({ returnTo: '/login' }),
            headers: {
                'content-type': 'application/x-www-form-urlencoded'
            }
        });

        const response = await logoutRoutePost(request);

        expect(logoutCurrentSession).toHaveBeenCalledTimes(1);
        expect(response.headers.get('location')).toBe('https://www.omrecipes.dev/login');
    });

    it('returns a non-cacheable null session payload for anonymous users', async () => {
        vi.mocked(getSession).mockResolvedValue(null);

        const response = await sessionRouteGet();

        expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
        await expect(response.json()).resolves.toEqual({ user: null });
    });

    it('returns a trimmed user payload for authenticated users', async () => {
        vi.mocked(getSession).mockResolvedValue({
            user: {
                id: 42,
                uuid: 'user-uuid',
                email: 'ian@example.com',
                name: 'Ian',
                emailVerifiedAt: new Date('2026-04-23T00:00:00Z')
            },
            author: null,
            session: {
                id: 99,
                expiresAt: new Date('2026-05-01T00:00:00Z')
            }
        });

        const response = await sessionRouteGet();

        await expect(response.json()).resolves.toEqual({
            user: {
                id: 42,
                uuid: 'user-uuid',
                email: 'ian@example.com',
                name: 'Ian'
            }
        });
    });
});
