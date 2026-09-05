import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let clearUserStateDirtyMock;
let listDirtyUserUuidsMock;
let reconcileSavedRecipesForUserMock;
let reconcileNotificationsForUserMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    stateKey: (uuid) => `state/users/${uuid}.json`,
    pendingKey: (uuid) => `pending/${uuid}`,
    clearUserStateDirty: (...args) => clearUserStateDirtyMock(...args),
    listDirtyUserUuids: (...args) => listDirtyUserUuidsMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    reconcileSavedRecipesForUser: (...args) => reconcileSavedRecipesForUserMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    reconcileNotificationsForUser: (...args) => reconcileNotificationsForUserMock(...args)
}));

describe('reconcileUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
        reconcileNotificationsForUserMock = vi.fn(() => Promise.resolve());
    });

    it('reconciles the blob\'s saved ids into Postgres and clears the dirty marker when it is unchanged', async () => {
        const marker = { since: 100 };
        getUserStateJsonMock = vi.fn((key) => {
            if (key === 'pending/abc-uuid') return Promise.resolve(marker);
            return Promise.resolve({ savedRecipeIds: [1, 2], notifications: [{ dedupeKey: 'comment:1', readAt: null }], userId: 20, hydratedAt: 1 });
        });
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).toHaveBeenCalledWith({ userId: 20, desiredRecipeIds: [1, 2] });
        expect(reconcileNotificationsForUserMock).toHaveBeenCalledWith({
            userId: 20,
            notifications: [{ dedupeKey: 'comment:1', readAt: null }]
        });
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });

    it('reconciles into Postgres but leaves the dirty marker set when it changed during reconciliation', async () => {
        let pendingCallCount = 0;
        getUserStateJsonMock = vi.fn((key) => {
            if (key === 'pending/abc-uuid') {
                pendingCallCount += 1;
                return Promise.resolve(pendingCallCount === 1 ? { since: 100 } : { since: 200 });
            }
            return Promise.resolve({ savedRecipeIds: [1, 2], notifications: [], userId: 20, hydratedAt: 1 });
        });
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).toHaveBeenCalledWith({ userId: 20, desiredRecipeIds: [1, 2] });
        expect(reconcileNotificationsForUserMock).toHaveBeenCalledWith({ userId: 20, notifications: [] });
        expect(clearUserStateDirtyMock).not.toHaveBeenCalled();
    });

    it('does nothing and returns immediately when there is no pending marker', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.resolve(null));
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).not.toHaveBeenCalled();
        expect(clearUserStateDirtyMock).not.toHaveBeenCalled();
    });

    it('clears the dirty marker without touching Postgres when the blob no longer exists but the marker does', async () => {
        const marker = { since: 100 };
        getUserStateJsonMock = vi.fn((key) => {
            if (key === 'pending/abc-uuid') return Promise.resolve(marker);
            return Promise.resolve(null);
        });
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).not.toHaveBeenCalled();
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });
});

describe('reconcileUserStateBestEffort', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('swallows a reconciliation error instead of throwing', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.reject(new Error('boom')));
        const { reconcileUserStateBestEffort } = await import('../lib/user-state-flush.js');

        await expect(reconcileUserStateBestEffort('abc-uuid')).resolves.toBeUndefined();
    });
});

describe('reconcileAllDirtyUserStates', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
        reconcileNotificationsForUserMock = vi.fn(() => Promise.resolve());
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
