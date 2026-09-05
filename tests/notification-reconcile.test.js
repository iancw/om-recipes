import { beforeEach, describe, expect, it, vi } from 'vitest';

let insertMock;
let updateMock;
let valuesMock;
let onConflictDoNothingMock;
let setMock;
let whereMock;

vi.mock('../db/index.ts', () => ({
    db: {
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

describe('reconcileNotificationsForUser', () => {
    beforeEach(() => {
        vi.resetModules();
        onConflictDoNothingMock = vi.fn(() => Promise.resolve());
        valuesMock = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothingMock }));
        insertMock = vi.fn(() => ({ values: valuesMock }));

        whereMock = vi.fn(() => Promise.resolve());
        setMock = vi.fn(() => ({ where: whereMock }));
        updateMock = vi.fn(() => ({ set: setMock }));
    });

    it('does nothing when there are no cached notifications', async () => {
        const { reconcileNotificationsForUser } = await import('../lib/notifications.js');

        await reconcileNotificationsForUser({ userId: 9, notifications: [] });
        await reconcileNotificationsForUser({ userId: 9, notifications: undefined });

        expect(insertMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('batch-inserts every cached notification with onConflictDoNothing, actorAuthorId null', async () => {
        const { reconcileNotificationsForUser } = await import('../lib/notifications.js');

        await reconcileNotificationsForUser({
            userId: 9,
            notifications: [
                { type: 'recipe_saved', recipeId: 5, sampleImageId: null, dedupeKey: 'save:5:20', readAt: null },
                { type: 'comment', recipeId: 5, sampleImageId: null, dedupeKey: 'comment:77', readAt: null }
            ]
        });

        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(valuesMock).toHaveBeenCalledWith([
            expect.objectContaining({ recipientUserId: 9, type: 'recipe_saved', recipeId: 5, actorAuthorId: null, dedupeKey: 'save:5:20' }),
            expect.objectContaining({ recipientUserId: 9, type: 'comment', recipeId: 5, actorAuthorId: null, dedupeKey: 'comment:77' })
        ]);
        expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    });

    it('propagates read receipts for cached notifications with readAt set', async () => {
        const { reconcileNotificationsForUser } = await import('../lib/notifications.js');

        await reconcileNotificationsForUser({
            userId: 9,
            notifications: [
                { type: 'comment', recipeId: 5, sampleImageId: null, dedupeKey: 'comment:77', readAt: 1234 },
                { type: 'comment', recipeId: 5, sampleImageId: null, dedupeKey: 'comment:78', readAt: null }
            ]
        });

        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
    });

    it('skips the read-receipt update when nothing is marked read', async () => {
        const { reconcileNotificationsForUser } = await import('../lib/notifications.js');

        await reconcileNotificationsForUser({
            userId: 9,
            notifications: [{ type: 'comment', recipeId: 5, sampleImageId: null, dedupeKey: 'comment:77', readAt: null }]
        });

        expect(updateMock).not.toHaveBeenCalled();
    });
});
