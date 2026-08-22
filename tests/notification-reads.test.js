import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let updateMock;
let getUnreadCount;
let getNotificationsForUser;
let markNotificationsRead;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

describe('notification read helpers', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        getUnreadCount = mod.getUnreadCount;
        getNotificationsForUser = mod.getNotificationsForUser;
        markNotificationsRead = mod.markNotificationsRead;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('counts unread notifications for a user', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 3 }]))
        }));

        await expect(getUnreadCount(9)).resolves.toBe(3);
    });

    it('lists recent notifications newest first, joined with recipe and actor name', async () => {
        const rows = [
            {
                id: 1,
                uuid: 'n-1',
                type: 'recipe_saved',
                readAt: null,
                createdAt: new Date('2026-08-20T00:00:00Z'),
                recipe: { id: 5, slug: 'golden-hour', uuid: 'r-uuid', recipeName: 'Golden Hour' },
                actorAuthorName: 'Jane'
            }
        ];
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(rows))
        }));

        await expect(getNotificationsForUser(9, { limit: 50 })).resolves.toEqual(rows);
    });

    it('marks all unread notifications read when no ids given', async () => {
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        await markNotificationsRead(9, {});

        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
    });

    it('marks only the given ids read when provided', async () => {
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        await markNotificationsRead(9, { ids: [1, 2] });

        expect(updateMock).toHaveBeenCalledTimes(1);
    });
});
