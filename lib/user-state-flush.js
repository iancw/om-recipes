import { getUserStateJson } from './user-state-store.js';
import { stateKey, clearUserStateDirty, listDirtyUserUuids } from './user-state-cache.js';
import { reconcileSavedRecipesForUser } from './recipe-saves.js';

export async function reconcileUserState(uuid) {
    const state = await getUserStateJson(stateKey(uuid));
    if (state) {
        await reconcileSavedRecipesForUser({ userId: state.userId, desiredRecipeIds: state.savedRecipeIds });
    }
    await clearUserStateDirty(uuid);
}

export async function reconcileAllDirtyUserStates() {
    const uuids = await listDirtyUserUuids();
    let reconciled = 0;
    let failed = 0;

    for (const uuid of uuids) {
        try {
            await reconcileUserState(uuid);
            reconciled += 1;
        } catch (error) {
            failed += 1;
            console.error('[user-state-flush] reconcile failed', { uuid, error });
        }
    }

    return { reconciled, failed };
}
