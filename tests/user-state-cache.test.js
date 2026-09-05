import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let setUserStateJsonMock;
let deleteUserStateKeyMock;
let listUserStateKeysMock;
let getAllSavedRecipeIdsForUserMock;
let authorSelectMock;
let getNotificationsForUserMock;
let getEffectivePreferencesMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args),
    setUserStateJson: (...args) => setUserStateJsonMock(...args),
    deleteUserStateKey: (...args) => deleteUserStateKeyMock(...args),
    listUserStateKeys: (...args) => listUserStateKeysMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    getAllSavedRecipeIdsForUser: (...args) => getAllSavedRecipeIdsForUserMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    getNotificationsForUser: (...args) => getNotificationsForUserMock(...args),
    getEffectivePreferences: (...args) => getEffectivePreferencesMock(...args)
}));

vi.mock('../db/index.ts', () => ({
    db: { select: (...args) => authorSelectMock(...args) }
}));

describe('stateKey / pendingKey', () => {
    it('build the expected key paths', async () => {
        const { stateKey, pendingKey } = await import('../lib/user-state-cache.js');
        expect(stateKey('abc-uuid')).toBe('state/users/abc-uuid.json');
        expect(pendingKey('abc-uuid')).toBe('pending/abc-uuid');
    });
});

describe('getUserSavedState', () => {
    beforeEach(() => {
        vi.resetModules();
        getUserStateJsonMock = vi.fn();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        getAllSavedRecipeIdsForUserMock = vi.fn(() => Promise.resolve(new Set([1, 2])));
        authorSelectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ id: 7 }]))
        }));
        getNotificationsForUserMock = vi.fn(() => Promise.resolve([]));
        getEffectivePreferencesMock = vi.fn(() =>
            Promise.resolve({ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: true, emailDigestEnabled: false })
        );
    });

    it('returns the cached blob without hydrating when one already exists', async () => {
        getUserStateJsonMock.mockResolvedValue({ savedRecipeIds: [3], authorIds: [7], notifications: [], preferences: {}, userId: 20, hydratedAt: 111 });
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(result).toEqual({ savedRecipeIds: [3], authorIds: [7], notifications: [], preferences: {}, userId: 20, hydratedAt: 111 });
        expect(getAllSavedRecipeIdsForUserMock).not.toHaveBeenCalled();
        expect(authorSelectMock).not.toHaveBeenCalled();
        expect(getNotificationsForUserMock).not.toHaveBeenCalled();
        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('backfills notifications and preferences onto a legacy blob without re-fetching saved recipes or author ids', async () => {
        getUserStateJsonMock.mockResolvedValue({ savedRecipeIds: [3], authorIds: [7], userId: 20, hydratedAt: 111 });
        getNotificationsForUserMock = vi.fn(() =>
            Promise.resolve([
                {
                    id: 1,
                    uuid: 'db-uuid-1',
                    type: 'comment',
                    dedupeKey: 'comment:9',
                    sampleImageId: null,
                    readAt: null,
                    createdAt: new Date('2026-08-20T00:00:00Z'),
                    recipe: { id: 5, slug: 'golden-hour', uuid: 'r-uuid', recipeName: 'Golden Hour' },
                    actorAuthorName: 'Jane'
                }
            ])
        );
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(getAllSavedRecipeIdsForUserMock).not.toHaveBeenCalled();
        expect(authorSelectMock).not.toHaveBeenCalled();
        expect(getNotificationsForUserMock).toHaveBeenCalledWith(20, { limit: 50 });
        expect(getEffectivePreferencesMock).toHaveBeenCalledWith(20);

        expect(result.savedRecipeIds).toEqual([3]);
        expect(result.authorIds).toEqual([7]);
        expect(result.userId).toBe(20);
        expect(result.hydratedAt).toBe(111);
        expect(result.notifications).toEqual([
            expect.objectContaining({
                type: 'comment',
                recipeId: 5,
                recipeSlug: 'golden-hour',
                recipeName: 'Golden Hour',
                dedupeKey: 'comment:9'
            })
        ]);
        expect(result.preferences).toEqual({
            notifyNewRecipe: false,
            notifySampleImage: true,
            notifySave: true,
            notifyComment: true,
            emailDigestEnabled: false
        });

        expect(setUserStateJsonMock).toHaveBeenCalledWith(
            'state/users/abc-uuid.json',
            expect.objectContaining({
                savedRecipeIds: [3],
                authorIds: [7],
                userId: 20,
                hydratedAt: 111,
                notifications: result.notifications,
                preferences: result.preferences
            })
        );
    });

    it('hydrates from Postgres — including notifications and preferences — and writes the blob when none exists yet', async () => {
        getUserStateJsonMock.mockResolvedValue(null);
        getNotificationsForUserMock = vi.fn(() =>
            Promise.resolve([
                {
                    id: 1,
                    uuid: 'db-uuid-1',
                    type: 'comment',
                    dedupeKey: 'comment:9',
                    sampleImageId: null,
                    readAt: null,
                    createdAt: new Date('2026-08-20T00:00:00Z'),
                    recipe: { id: 5, slug: 'golden-hour', uuid: 'r-uuid', recipeName: 'Golden Hour' },
                    actorAuthorName: 'Jane'
                }
            ])
        );
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(getAllSavedRecipeIdsForUserMock).toHaveBeenCalledWith(20);
        expect(authorSelectMock).toHaveBeenCalled();
        expect(getNotificationsForUserMock).toHaveBeenCalledWith(20, { limit: 50 });
        expect(getEffectivePreferencesMock).toHaveBeenCalledWith(20);
        expect(result.savedRecipeIds.sort()).toEqual([1, 2]);
        expect(result.authorIds).toEqual([7]);
        expect(result.notifications).toEqual([
            expect.objectContaining({
                type: 'comment',
                recipeId: 5,
                recipeSlug: 'golden-hour',
                recipeName: 'Golden Hour',
                actorAuthorName: 'Jane',
                sampleImageId: null,
                dedupeKey: 'comment:9',
                readAt: null
            })
        ]);
        expect(typeof result.notifications[0].uuid).toBe('string');
        expect(typeof result.notifications[0].createdAt).toBe('number');
        expect(result.preferences).toEqual({
            notifyNewRecipe: false,
            notifySampleImage: true,
            notifySave: true,
            notifyComment: true,
            emailDigestEnabled: false
        });
        expect(result.userId).toBe(20);
        expect(typeof result.hydratedAt).toBe('number');
        expect(setUserStateJsonMock).toHaveBeenCalledWith(
            'state/users/abc-uuid.json',
            expect.objectContaining({ userId: 20, authorIds: [7], notifications: result.notifications, preferences: result.preferences })
        );
    });
});

describe('addAuthorIdToUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
    });

    it('does nothing when the user has no cached blob yet', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue(null);
        const { addAuthorIdToUserState } = await import('../lib/user-state-cache.js');

        await addAuthorIdToUserState('abc-uuid', 7);

        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('appends a new author id to an existing blob', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [], authorIds: [], userId: 20, hydratedAt: 1 });
        const { addAuthorIdToUserState } = await import('../lib/user-state-cache.js');

        await addAuthorIdToUserState('abc-uuid', 7);

        expect(setUserStateJsonMock).toHaveBeenCalledWith('state/users/abc-uuid.json', expect.objectContaining({ authorIds: [7] }));
    });

    it('is a no-op when the author id is already cached', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [], authorIds: [7], userId: 20, hydratedAt: 1 });
        const { addAuthorIdToUserState } = await import('../lib/user-state-cache.js');

        await addAuthorIdToUserState('abc-uuid', 7);

        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });
});

describe('toggleSavedRecipeInState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        getAllSavedRecipeIdsForUserMock = vi.fn(() => Promise.resolve(new Set()));
    });

    it('adds the recipe and returns true when not currently saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1], authorIds: [], notifications: [], preferences: {}, userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(true);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds.sort()).toEqual([1, 5]);
    });

    it('removes the recipe and returns false when already saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1, 5], authorIds: [], notifications: [], preferences: {}, userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(false);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds).toEqual([1]);
    });

    it('marks the user dirty as a side effect', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [], authorIds: [], notifications: [], preferences: {}, userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });
});

describe('dirty tracking', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        deleteUserStateKeyMock = vi.fn(() => Promise.resolve());
        listUserStateKeysMock = vi.fn(() => Promise.resolve(['pending/abc-uuid', 'pending/def-uuid']));
    });

    it('markUserStateDirty writes a pending marker', async () => {
        const { markUserStateDirty } = await import('../lib/user-state-cache.js');
        await markUserStateDirty('abc-uuid');
        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });

    it('clearUserStateDirty deletes the pending marker', async () => {
        const { clearUserStateDirty } = await import('../lib/user-state-cache.js');
        await clearUserStateDirty('abc-uuid');
        expect(deleteUserStateKeyMock).toHaveBeenCalledWith('pending/abc-uuid');
    });

    it('listDirtyUserUuids strips the prefix', async () => {
        const { listDirtyUserUuids } = await import('../lib/user-state-cache.js');
        const uuids = await listDirtyUserUuids();
        expect(uuids).toEqual(['abc-uuid', 'def-uuid']);
        expect(listUserStateKeysMock).toHaveBeenCalledWith('pending/');
    });
});

describe('unreadNotificationCount', () => {
    it('counts only entries with a null readAt', async () => {
        const { unreadNotificationCount } = await import('../lib/user-state-cache.js');
        expect(unreadNotificationCount([{ readAt: null }, { readAt: 123 }, { readAt: null }])).toBe(2);
    });

    it('treats a missing array as zero unread', async () => {
        const { unreadNotificationCount } = await import('../lib/user-state-cache.js');
        expect(unreadNotificationCount(undefined)).toBe(0);
    });
});

describe('appendNotificationToUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
    });

    it('appends a new notification to the front of the list and marks the user dirty', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [{ uuid: 'existing', type: 'comment', dedupeKey: 'comment:1', readAt: null, createdAt: 1 }],
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { appendNotificationToUserState } = await import('../lib/user-state-cache.js');

        const appended = await appendNotificationToUserState('abc-uuid', 20, {
            type: 'recipe_saved',
            recipeId: 5,
            recipeSlug: 'golden-hour',
            recipeName: 'Golden Hour',
            actorAuthorName: 'Jane',
            sampleImageId: null,
            dedupeKey: 'save:5:9'
        });

        expect(appended).toBe(true);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.notifications).toHaveLength(2);
        expect(writtenBlob.notifications[0]).toEqual(
            expect.objectContaining({ type: 'recipe_saved', recipeId: 5, dedupeKey: 'save:5:9', readAt: null })
        );
        expect(typeof writtenBlob.notifications[0].uuid).toBe('string');
        expect(writtenBlob.notifications[1].uuid).toBe('existing');
        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });

    it('is a no-op when a notification with the same dedupeKey already exists', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [{ uuid: 'existing', type: 'recipe_saved', dedupeKey: 'save:5:9', readAt: null, createdAt: 1 }],
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { appendNotificationToUserState } = await import('../lib/user-state-cache.js');

        const appended = await appendNotificationToUserState('abc-uuid', 20, {
            type: 'recipe_saved',
            recipeId: 5,
            dedupeKey: 'save:5:9'
        });

        expect(appended).toBe(false);
        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('caps the cached list at 50 entries, dropping the oldest', async () => {
        const fiftyExisting = Array.from({ length: 50 }, (_, i) => ({
            uuid: `n-${i}`,
            type: 'comment',
            dedupeKey: `comment:${i}`,
            readAt: null,
            createdAt: i
        }));
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: fiftyExisting,
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { appendNotificationToUserState } = await import('../lib/user-state-cache.js');

        await appendNotificationToUserState('abc-uuid', 20, { type: 'comment', recipeId: 5, dedupeKey: 'comment:new' });

        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.notifications).toHaveLength(50);
        expect(writtenBlob.notifications[0].dedupeKey).toBe('comment:new');
        expect(writtenBlob.notifications.some((n) => n.dedupeKey === 'comment:49')).toBe(false);
    });
});

describe('markNotificationsReadInUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
    });

    it('marks every unread entry read when no uuids are given', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [
                { uuid: 'a', readAt: null, createdAt: 1 },
                { uuid: 'b', readAt: 123, createdAt: 2 },
                { uuid: 'c', readAt: null, createdAt: 3 }
            ],
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { markNotificationsReadInUserState } = await import('../lib/user-state-cache.js');

        await markNotificationsReadInUserState('abc-uuid', 20);

        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.notifications.find((n) => n.uuid === 'a').readAt).toEqual(expect.any(Number));
        expect(writtenBlob.notifications.find((n) => n.uuid === 'b').readAt).toBe(123);
        expect(writtenBlob.notifications.find((n) => n.uuid === 'c').readAt).toEqual(expect.any(Number));
        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });

    it('marks only the given uuids when provided', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [
                { uuid: 'a', readAt: null, createdAt: 1 },
                { uuid: 'c', readAt: null, createdAt: 3 }
            ],
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { markNotificationsReadInUserState } = await import('../lib/user-state-cache.js');

        await markNotificationsReadInUserState('abc-uuid', 20, { uuids: ['a'] });

        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.notifications.find((n) => n.uuid === 'a').readAt).toEqual(expect.any(Number));
        expect(writtenBlob.notifications.find((n) => n.uuid === 'c').readAt).toBeNull();
    });

    it('is a no-op when nothing changes', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [{ uuid: 'a', readAt: 999, createdAt: 1 }],
            preferences: {},
            userId: 20,
            hydratedAt: 1
        });
        const { markNotificationsReadInUserState } = await import('../lib/user-state-cache.js');

        await markNotificationsReadInUserState('abc-uuid', 20);

        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });
});

describe('setUserStatePreferences', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
    });

    it('does nothing when the user has no cached blob yet', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue(null);
        const { setUserStatePreferences } = await import('../lib/user-state-cache.js');

        await setUserStatePreferences('abc-uuid', { notifySave: false });

        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('replaces the cached preferences without marking the user dirty', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({
            savedRecipeIds: [],
            authorIds: [],
            notifications: [],
            preferences: { notifySave: true },
            userId: 20,
            hydratedAt: 1
        });
        const { setUserStatePreferences } = await import('../lib/user-state-cache.js');

        await setUserStatePreferences('abc-uuid', { notifySave: false });

        expect(setUserStateJsonMock).toHaveBeenCalledTimes(1);
        expect(setUserStateJsonMock).toHaveBeenCalledWith(
            'state/users/abc-uuid.json',
            expect.objectContaining({ preferences: { notifySave: false } })
        );
    });
});
