import { getUserStateJson, setUserStateJson, deleteUserStateKey, listUserStateKeys } from './user-state-store.js';
import { getAllSavedRecipeIdsForUser } from './recipe-saves.js';
import { db } from '../db/index.ts';
import { authors } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

const STATE_PREFIX = 'state/users/';
const PENDING_PREFIX = 'pending/';

export function stateKey(uuid) {
    return `${STATE_PREFIX}${uuid}.json`;
}

export function pendingKey(uuid) {
    return `${PENDING_PREFIX}${uuid}`;
}

async function getAuthorIdsForUser(userId) {
    if (userId == null) return [];

    const rows = await db.select({ id: authors.id }).from(authors).where(eq(authors.userId, userId));
    return rows.map((row) => row.id);
}

export async function getUserSavedState(uuid, userId) {
    const existing = await getUserStateJson(stateKey(uuid));
    if (existing) return existing;

    const [savedRecipeIds, authorIds] = await Promise.all([
        getAllSavedRecipeIdsForUser(userId).then((set) => [...set]),
        getAuthorIdsForUser(userId)
    ]);
    const hydrated = { savedRecipeIds, authorIds, userId, hydratedAt: Date.now() };
    await setUserStateJson(stateKey(uuid), hydrated);
    return hydrated;
}

export async function addAuthorIdToUserState(uuid, authorId) {
    const existing = await getUserStateJson(stateKey(uuid));
    if (!existing) return;

    const authorIds = existing.authorIds ?? [];
    if (authorIds.includes(authorId)) return;

    await setUserStateJson(stateKey(uuid), { ...existing, authorIds: [...authorIds, authorId] });
}

export async function toggleSavedRecipeInState(uuid, userId, recipeId) {
    const state = await getUserSavedState(uuid, userId);
    const set = new Set(state.savedRecipeIds);
    const isSaved = !set.has(recipeId);

    if (isSaved) {
        set.add(recipeId);
    } else {
        set.delete(recipeId);
    }

    const nextState = { ...state, savedRecipeIds: [...set] };
    await setUserStateJson(stateKey(uuid), nextState);
    await markUserStateDirty(uuid);
    return isSaved;
}

export async function markUserStateDirty(uuid) {
    await setUserStateJson(pendingKey(uuid), { since: Date.now() });
}

export async function clearUserStateDirty(uuid) {
    await deleteUserStateKey(pendingKey(uuid));
}

export async function listDirtyUserUuids() {
    const keys = await listUserStateKeys(PENDING_PREFIX);
    return keys.map((key) => key.slice(PENDING_PREFIX.length));
}
