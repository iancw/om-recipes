import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let setUserStateJsonMock;
let deleteUserStateKeyMock;
let listUserStateKeysMock;
let getAllSavedRecipeIdsForUserMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args),
    setUserStateJson: (...args) => setUserStateJsonMock(...args),
    deleteUserStateKey: (...args) => deleteUserStateKeyMock(...args),
    listUserStateKeys: (...args) => listUserStateKeysMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    getAllSavedRecipeIdsForUser: (...args) => getAllSavedRecipeIdsForUserMock(...args)
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
    });

    it('returns the cached blob without hydrating when one already exists', async () => {
        getUserStateJsonMock.mockResolvedValue({ savedRecipeIds: [3], userId: 20, hydratedAt: 111 });
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(result).toEqual({ savedRecipeIds: [3], userId: 20, hydratedAt: 111 });
        expect(getAllSavedRecipeIdsForUserMock).not.toHaveBeenCalled();
        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('hydrates from Postgres and writes the blob when none exists yet', async () => {
        getUserStateJsonMock.mockResolvedValue(null);
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(getAllSavedRecipeIdsForUserMock).toHaveBeenCalledWith(20);
        expect(result.savedRecipeIds.sort()).toEqual([1, 2]);
        expect(result.userId).toBe(20);
        expect(typeof result.hydratedAt).toBe('number');
        expect(setUserStateJsonMock).toHaveBeenCalledWith('state/users/abc-uuid.json', expect.objectContaining({ userId: 20 }));
    });
});

describe('toggleSavedRecipeInState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        getAllSavedRecipeIdsForUserMock = vi.fn(() => Promise.resolve(new Set()));
    });

    it('adds the recipe and returns true when not currently saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(true);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds.sort()).toEqual([1, 5]);
    });

    it('removes the recipe and returns false when already saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1, 5], userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(false);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds).toEqual([1]);
    });

    it('marks the user dirty as a side effect', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [], userId: 20, hydratedAt: 1 });
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
