import { randomUUID } from 'node:crypto';
import { getUserStateJson, setUserStateJson, deleteUserStateKey, listUserStateKeys } from './user-state-store.js';
import { getAllSavedRecipeIdsForUser } from './recipe-saves.js';
import { db } from '../db/index.ts';
import { authors } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

const STATE_PREFIX = 'state/users/';
const PENDING_PREFIX = 'pending/';
const MAX_CACHED_NOTIFICATIONS = 50;

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

function toEpochMs(value) {
    if (value instanceof Date) return value.getTime();
    return value ?? null;
}

function toNotificationEntry(row) {
    return {
        uuid: randomUUID(),
        type: row.type,
        recipeId: row.recipe?.id ?? null,
        recipeSlug: row.recipe?.slug ?? null,
        recipeName: row.recipe?.recipeName ?? null,
        actorAuthorName: row.actorAuthorName ?? null,
        sampleImageId: row.sampleImageId ?? null,
        dedupeKey: row.dedupeKey,
        createdAt: toEpochMs(row.createdAt) ?? Date.now(),
        readAt: toEpochMs(row.readAt)
    };
}

export function unreadNotificationCount(notifications) {
    return (notifications ?? []).filter((entry) => entry.readAt == null).length;
}

export async function getUserSavedState(uuid, userId) {
    const existing = await getUserStateJson(stateKey(uuid));
    if (existing) return existing;

    const { getNotificationsForUser, getEffectivePreferences } = await import('./notifications.js');

    const [savedRecipeIds, authorIds, notificationRows, preferences] = await Promise.all([
        getAllSavedRecipeIdsForUser(userId).then((set) => [...set]),
        getAuthorIdsForUser(userId),
        getNotificationsForUser(userId, { limit: MAX_CACHED_NOTIFICATIONS }),
        getEffectivePreferences(userId)
    ]);

    const hydrated = {
        savedRecipeIds,
        authorIds,
        notifications: notificationRows.map(toNotificationEntry),
        preferences,
        userId,
        hydratedAt: Date.now()
    };
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

export async function appendNotificationToUserState(uuid, userId, notification) {
    const state = await getUserSavedState(uuid, userId);
    const existingNotifications = state.notifications ?? [];

    if (existingNotifications.some((entry) => entry.dedupeKey === notification.dedupeKey)) {
        return false;
    }

    const entry = {
        uuid: randomUUID(),
        type: notification.type,
        recipeId: notification.recipeId ?? null,
        recipeSlug: notification.recipeSlug ?? null,
        recipeName: notification.recipeName ?? null,
        actorAuthorName: notification.actorAuthorName ?? null,
        sampleImageId: notification.sampleImageId ?? null,
        dedupeKey: notification.dedupeKey,
        createdAt: Date.now(),
        readAt: null
    };

    const nextNotifications = [entry, ...existingNotifications].slice(0, MAX_CACHED_NOTIFICATIONS);
    await setUserStateJson(stateKey(uuid), { ...state, notifications: nextNotifications });
    await markUserStateDirty(uuid);
    return true;
}

export async function markNotificationsReadInUserState(uuid, userId, { uuids } = {}) {
    const state = await getUserSavedState(uuid, userId);
    const targetUuids = Array.isArray(uuids) && uuids.length > 0 ? new Set(uuids) : null;
    const now = Date.now();
    let changed = false;

    const nextNotifications = (state.notifications ?? []).map((entry) => {
        if (entry.readAt != null) return entry;
        if (targetUuids && !targetUuids.has(entry.uuid)) return entry;
        changed = true;
        return { ...entry, readAt: now };
    });

    if (!changed) return;

    await setUserStateJson(stateKey(uuid), { ...state, notifications: nextNotifications });
    await markUserStateDirty(uuid);
}

export async function setUserStatePreferences(uuid, preferences) {
    const existing = await getUserStateJson(stateKey(uuid));
    if (!existing) return;

    await setUserStateJson(stateKey(uuid), { ...existing, preferences });
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
