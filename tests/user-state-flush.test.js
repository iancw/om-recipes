import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let clearUserStateDirtyMock;
let listDirtyUserUuidsMock;
let reconcileSavedRecipesForUserMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    stateKey: (uuid) => `state/users/${uuid}.json`,
    clearUserStateDirty: (...args) => clearUserStateDirtyMock(...args),
    listDirtyUserUuids: (...args) => listDirtyUserUuidsMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    reconcileSavedRecipesForUser: (...args) => reconcileSavedRecipesForUserMock(...args)
}));

describe('reconcileUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
    });

    it('reconciles the blob\'s saved ids into Postgres and clears the dirty marker', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.resolve({ savedRecipeIds: [1, 2], userId: 20, hydratedAt: 1 }));
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).toHaveBeenCalledWith({ userId: 20, desiredRecipeIds: [1, 2] });
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });

    it('clears the dirty marker without touching Postgres when the blob no longer exists', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.resolve(null));
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).not.toHaveBeenCalled();
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });
});

describe('reconcileAllDirtyUserStates', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
    });

    it('reconciles every dirty user and reports a summary', async () => {
        listDirtyUserUuidsMock = vi.fn(() => Promise.resolve(['abc-uuid', 'def-uuid']));
        getUserStateJsonMock = vi.fn(() => Promise.resolve({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 }));
        const { reconcileAllDirtyUserStates } = await import('../lib/user-state-flush.js');

        const summary = await reconcileAllDirtyUserStates();

        expect(summary).toEqual({ reconciled: 2, failed: 0 });
    });

    it('isolates one user\'s failure from the rest of the batch', async () => {
        listDirtyUserUuidsMock = vi.fn(() => Promise.resolve(['abc-uuid', 'def-uuid']));
        let call = 0;
        getUserStateJsonMock = vi.fn(() => {
            call += 1;
            if (call === 1) return Promise.reject(new Error('boom'));
            return Promise.resolve({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 });
        });
        const { reconcileAllDirtyUserStates } = await import('../lib/user-state-flush.js');

        const summary = await reconcileAllDirtyUserStates();

        expect(summary).toEqual({ reconciled: 1, failed: 1 });
    });
});
