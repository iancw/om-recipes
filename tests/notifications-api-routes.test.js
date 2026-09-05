import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

let requireUserMock;
let getUserSavedStateMock;
let markNotificationsReadInUserStateMock;
let GET;
let POST;

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    unreadNotificationCount: (notifications) =>
        (notifications ?? []).filter((entry) => entry.readAt == null).length,
    getUserSavedState: (...args) => getUserSavedStateMock(...args),
    markNotificationsReadInUserState: (...args) => markNotificationsReadInUserStateMock(...args)
}));

describe('notifications API routes', () => {
    beforeEach(async () => {
        vi.resetModules();
        const listMod = await import('../app/api/notifications/route.js');
        const readMod = await import('../app/api/notifications/read/route.js');
        GET = listMod.GET;
        POST = readMod.POST;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('GET /api/notifications', () => {
        it('returns 401 when not authenticated', async () => {
            requireUserMock = vi.fn(() => Promise.reject(new Error('Not authenticated')));

            const response = await GET();

            expect(response.status).toBe(401);
        });

        it('returns the cached items and a derived unread count for an authenticated user', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9, uuid: 'user-uuid' } }));
            getUserSavedStateMock = vi.fn(() =>
                Promise.resolve({
                    notifications: [
                        { uuid: 'n-1', readAt: null },
                        { uuid: 'n-2', readAt: 123 }
                    ]
                })
            );

            const response = await GET();

            expect(getUserSavedStateMock).toHaveBeenCalledWith('user-uuid', 9);
            await expect(response.json()).resolves.toEqual({
                items: [
                    { uuid: 'n-1', readAt: null },
                    { uuid: 'n-2', readAt: 123 }
                ],
                unreadCount: 1
            });
        });
    });

    describe('POST /api/notifications/read', () => {
        it('returns 401 when not authenticated', async () => {
            requireUserMock = vi.fn(() => Promise.reject(new Error('Not authenticated')));

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(response.status).toBe(401);
        });

        it('marks all unread when no uuids are given', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9, uuid: 'user-uuid' } }));
            markNotificationsReadInUserStateMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadInUserStateMock).toHaveBeenCalledWith('user-uuid', 9, { uuids: undefined });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });

        it('marks only the given uuids when provided', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9, uuid: 'user-uuid' } }));
            markNotificationsReadInUserStateMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({ uuids: ['n-1', 42, 'n-2'] }),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadInUserStateMock).toHaveBeenCalledWith('user-uuid', 9, { uuids: ['n-1', 'n-2'] });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });
    });
});
