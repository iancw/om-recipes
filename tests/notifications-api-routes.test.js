import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

let requireUserMock;
let getNotificationsForUserMock;
let getUnreadCountMock;
let markNotificationsReadMock;
let GET;
let POST;

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    getNotificationsForUser: (...args) => getNotificationsForUserMock(...args),
    getUnreadCount: (...args) => getUnreadCountMock(...args),
    markNotificationsRead: (...args) => markNotificationsReadMock(...args)
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

        it('returns items and unread count for an authenticated user', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            getNotificationsForUserMock = vi.fn(() => Promise.resolve([{ id: 1 }]));
            getUnreadCountMock = vi.fn(() => Promise.resolve(1));

            const response = await GET();

            expect(getNotificationsForUserMock).toHaveBeenCalledWith(9, { limit: 50 });
            expect(getUnreadCountMock).toHaveBeenCalledWith(9);
            await expect(response.json()).resolves.toEqual({ items: [{ id: 1 }], unreadCount: 1 });
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

        it('marks all unread when no ids are given', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            markNotificationsReadMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadMock).toHaveBeenCalledWith(9, { ids: undefined });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });

        it('marks only the given ids when provided', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            markNotificationsReadMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({ ids: [1, 2, 'x'] }),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadMock).toHaveBeenCalledWith(9, { ids: [1, 2] });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });
    });
});
