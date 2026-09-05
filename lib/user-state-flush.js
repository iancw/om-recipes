import { getUserStateJson } from './user-state-store.js';
import { stateKey, pendingKey, clearUserStateDirty, listDirtyUserUuids } from './user-state-cache.js';
import { reconcileSavedRecipesForUser } from './recipe-saves.js';
import { reconcileNotificationsForUser } from './notifications.js';

export async function reconcileUserState(uuid) {
    const markerBefore = await getUserStateJson(pendingKey(uuid));
    if (!markerBefore) return;

    const state = await getUserStateJson(stateKey(uuid));
    if (state) {
        await reconcileSavedRecipesForUser({ userId: state.userId, desiredRecipeIds: state.savedRecipeIds });
        await reconcileNotificationsForUser({ userId: state.userId, notifications: state.notifications });
    }

    const markerAfter = await getUserStateJson(pendingKey(uuid));
    if (markerAfter?.since === markerBefore.since) {
        await clearUserStateDirty(uuid);
    }
}

export async function reconcileUserStateBestEffort(uuid) {
    try {
        await reconcileUserState(uuid);
    } catch (error) {
        console.error('[user-state-flush] piggyback reconcile failed', { uuid, error });
    }
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
