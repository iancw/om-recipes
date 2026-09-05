import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getNotificationsForUser;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

describe('notification read helpers', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        getNotificationsForUser = mod.getNotificationsForUser;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lists recent notifications newest first, joined with recipe and actor name', async () => {
        const rows = [
            {
                id: 1,
                uuid: 'n-1',
                type: 'recipe_saved',
                dedupeKey: 'save:5:20',
                sampleImageId: null,
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
});
