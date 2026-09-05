// tests/notification-writers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let notifyRecipeSaved;
let notifySampleImageAdded;
let notifyNewRecipe;
let saveDedupeKey;
let sampleImageDedupeKey;
let newRecipeDedupeKey;
let appendNotificationToUserStateMock;
let getRecipeIndexMock;
let getUserSavedStateMock;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

vi.mock('../lib/user-state-cache.js', () => ({
    appendNotificationToUserState: (...args) => appendNotificationToUserStateMock(...args),
    getUserSavedState: (...args) => getUserSavedStateMock(...args)
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    getRecipeIndex: (...args) => getRecipeIndexMock(...args)
}));

function selectSequence(responses) {
    const queue = [...responses];
    return vi.fn(() => {
        const res = queue.shift() ?? [];
        return {
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(res)),
            then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
    });
}

function insertRecorder() {
    const onConflictDoNothing = vi.fn(() => Promise.resolve());
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    return { insert, values, onConflictDoNothing };
}

describe('notification writers', () => {
    beforeEach(async () => {
        vi.resetModules();
        appendNotificationToUserStateMock = vi.fn(() => Promise.resolve(true));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 5, slug: 'golden-hour', recipeName: 'Golden Hour' }]));
        getUserSavedStateMock = vi.fn(() => Promise.resolve({ preferences: { notifySave: true } }));
        const mod = await import('../lib/notifications.js');
        notifyRecipeSaved = mod.notifyRecipeSaved;
        notifySampleImageAdded = mod.notifySampleImageAdded;
        notifyNewRecipe = mod.notifyNewRecipe;
        saveDedupeKey = mod.saveDedupeKey;
        sampleImageDedupeKey = mod.sampleImageDedupeKey;
        newRecipeDedupeKey = mod.newRecipeDedupeKey;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds the spec dedupe key formats', () => {
        expect(saveDedupeKey(5, 9)).toBe('save:5:9');
        expect(sampleImageDedupeKey(7)).toBe('sample:7');
        expect(newRecipeDedupeKey(5, 9)).toBe('newrecipe:5:9');
    });

    describe('notifyRecipeSaved', () => {
        it('skips when the saver is the recipe owner', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }]]);

            await notifyRecipeSaved(5, 9);

            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });

        it('skips when the owner has notifySave off in their cached preferences', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }]]);
            getUserSavedStateMock = vi.fn(() => Promise.resolve({ preferences: { notifySave: false } }));

            await notifyRecipeSaved(5, 20);

            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });

        it('does nothing when the recipe has no notifiable owner', async () => {
            selectMock = selectSequence([[]]);

            await notifyRecipeSaved(5, 20);

            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });

        it('does nothing when the owner has no linked user account', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: null, ownerUuid: null }]]);

            await notifyRecipeSaved(5, 20);

            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });

        it('appends a cache entry to the owner blob with the saver author name resolved, with no Postgres write', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }],
                [{ name: 'Jane' }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyRecipeSaved(5, 20);

            expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('owner-uuid', 9, {
                type: 'recipe_saved',
                recipeId: 5,
                recipeSlug: 'golden-hour',
                recipeName: 'Golden Hour',
                actorAuthorName: 'Jane',
                sampleImageId: null,
                dedupeKey: 'save:5:20'
            });
            expect(rec.insert).not.toHaveBeenCalled();
        });
    });

    describe('notifySampleImageAdded', () => {
        it('skips when the contributor is the owner (self-upload)', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }]]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifySampleImageAdded(5, 100, 1);

            expect(rec.insert).not.toHaveBeenCalled();
            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });

        it('inserts and cache-appends when a different author contributes a sample', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }],
                [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, emailDigestEnabled: true }],
                [{ name: 'Alex' }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifySampleImageAdded(5, 100, 2);

            expect(rec.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    recipientUserId: 9,
                    type: 'sample_image_added',
                    recipeId: 5,
                    actorAuthorId: 2,
                    sampleImageId: 100,
                    dedupeKey: 'sample:100'
                })
            );
            expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('owner-uuid', 9, {
                type: 'sample_image_added',
                recipeId: 5,
                recipeSlug: 'golden-hour',
                recipeName: 'Golden Hour',
                actorAuthorName: 'Alex',
                sampleImageId: 100,
                dedupeKey: 'sample:100'
            });
        });

        it('does not cache-append when the owner has no linked user account', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9, ownerUuid: null }],
                [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, emailDigestEnabled: true }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifySampleImageAdded(5, 100, 2);

            expect(rec.values).toHaveBeenCalled();
            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });
    });

    describe('notifyNewRecipe', () => {
        it('fans out to opted-in users, excluding the recipe author', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }],
                [{ userId: 9 }, { userId: 20 }, { userId: 21 }],
                [{ name: 'Sam' }],
                [{ id: 20, uuid: 'uuid-20' }, { id: 21, uuid: 'uuid-21' }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyNewRecipe(5);

            expect(rec.values).toHaveBeenCalledWith([
                expect.objectContaining({ recipientUserId: 20, dedupeKey: 'newrecipe:5:20' }),
                expect.objectContaining({ recipientUserId: 21, dedupeKey: 'newrecipe:5:21' })
            ]);
            expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('uuid-20', 20, expect.objectContaining({
                type: 'new_recipe',
                dedupeKey: 'newrecipe:5:20',
                actorAuthorName: 'Sam'
            }));
            expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('uuid-21', 21, expect.objectContaining({
                type: 'new_recipe',
                dedupeKey: 'newrecipe:5:21',
                actorAuthorName: 'Sam'
            }));
        });

        it('does nothing when nobody is opted in', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }], []]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyNewRecipe(5);

            expect(rec.insert).not.toHaveBeenCalled();
            expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
        });
    });

    it('swallows and logs a failure instead of throwing', async () => {
        selectMock = vi.fn(() => {
            throw new Error('db down');
        });

        await expect(notifyRecipeSaved(5, 20)).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });
});
