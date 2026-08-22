import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authors, notificationPreferences, notifications, recipes, users } from '../db/schema.ts';

export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
    notifyNewRecipe: false,
    notifySampleImage: true,
    notifySave: true,
    emailDigestEnabled: true
});

export async function getEffectivePreferences(userId) {
    const rows = await db
        .select({
            notifyNewRecipe: notificationPreferences.notifyNewRecipe,
            notifySampleImage: notificationPreferences.notifySampleImage,
            notifySave: notificationPreferences.notifySave,
            emailDigestEnabled: notificationPreferences.emailDigestEnabled
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);

    return rows[0] ?? { ...NOTIFICATION_PREFERENCE_DEFAULTS };
}

export async function upsertNotificationPreferences(userId, values) {
    const normalized = {
        notifyNewRecipe: Boolean(values?.notifyNewRecipe),
        notifySampleImage: Boolean(values?.notifySampleImage),
        notifySave: Boolean(values?.notifySave),
        emailDigestEnabled: Boolean(values?.emailDigestEnabled)
    };

    await db
        .insert(notificationPreferences)
        .values({ userId, ...normalized })
        .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { ...normalized, updatedAt: new Date() }
        });
}

export function saveDedupeKey(recipeId, saverUserId) {
    return `save:${recipeId}:${saverUserId}`;
}

export function sampleImageDedupeKey(sampleImageId) {
    return `sample:${sampleImageId}`;
}

export function newRecipeDedupeKey(recipeId, recipientUserId) {
    return `newrecipe:${recipeId}:${recipientUserId}`;
}

async function withFailureIsolation(label, fn) {
    try {
        await fn();
    } catch (error) {
        console.error(`[notifications] ${label} failed`, error);
    }
}

async function getRecipeOwner(recipeId) {
    const rows = await db
        .select({
            authorId: authors.id,
            ownerUserId: authors.userId
        })
        .from(recipes)
        .innerJoin(authors, eq(authors.id, recipes.authorId))
        .where(eq(recipes.id, recipeId))
        .limit(1);

    return rows[0] ?? null;
}

export async function notifyRecipeSaved(recipeId, saverUserId) {
    await withFailureIsolation('notifyRecipeSaved', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId) return;
        if (owner.ownerUserId === saverUserId) return;

        const prefs = await getEffectivePreferences(owner.ownerUserId);
        if (!prefs.notifySave) return;

        const saverAuthorRows = await db
            .select({ id: authors.id })
            .from(authors)
            .where(eq(authors.userId, saverUserId))
            .orderBy(asc(authors.id))
            .limit(1);
        const actorAuthorId = saverAuthorRows[0]?.id ?? null;

        await db
            .insert(notifications)
            .values({
                recipientUserId: owner.ownerUserId,
                type: 'recipe_saved',
                recipeId,
                actorAuthorId,
                dedupeKey: saveDedupeKey(recipeId, saverUserId)
            })
            .onConflictDoNothing();
    });
}

export async function notifySampleImageAdded(recipeId, sampleImageId, contributorAuthorId) {
    await withFailureIsolation('notifySampleImageAdded', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId) return;
        if (owner.authorId === contributorAuthorId) return;

        const prefs = await getEffectivePreferences(owner.ownerUserId);
        if (!prefs.notifySampleImage) return;

        await db
            .insert(notifications)
            .values({
                recipientUserId: owner.ownerUserId,
                type: 'sample_image_added',
                recipeId,
                actorAuthorId: contributorAuthorId,
                sampleImageId,
                dedupeKey: sampleImageDedupeKey(sampleImageId)
            })
            .onConflictDoNothing();
    });
}

export async function notifyNewRecipe(recipeId) {
    await withFailureIsolation('notifyNewRecipe', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner) return;

        const subscriberRows = await db
            .select({ userId: notificationPreferences.userId })
            .from(notificationPreferences)
            .where(eq(notificationPreferences.notifyNewRecipe, true));

        const recipientUserIds = subscriberRows
            .map((row) => row.userId)
            .filter((userId) => userId !== owner.ownerUserId);

        if (recipientUserIds.length === 0) return;

        await db
            .insert(notifications)
            .values(
                recipientUserIds.map((recipientUserId) => ({
                    recipientUserId,
                    type: 'new_recipe',
                    recipeId,
                    actorAuthorId: owner.authorId,
                    dedupeKey: newRecipeDedupeKey(recipeId, recipientUserId)
                }))
            )
            .onConflictDoNothing();
    });
}

export async function getUnreadCount(userId) {
    const rows = await db
        .select({ value: sql`count(*)`.mapWith(Number) })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));

    return rows[0]?.value ?? 0;
}

export async function getNotificationsForUser(userId, { limit = 50 } = {}) {
    return db
        .select({
            id: notifications.id,
            uuid: notifications.uuid,
            type: notifications.type,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
            recipe: {
                id: recipes.id,
                slug: recipes.slug,
                uuid: recipes.uuid,
                recipeName: recipes.recipeName
            },
            actorAuthorName: authors.name
        })
        .from(notifications)
        .innerJoin(recipes, eq(recipes.id, notifications.recipeId))
        .leftJoin(authors, eq(authors.id, notifications.actorAuthorId))
        .where(eq(notifications.recipientUserId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
}

export async function markNotificationsRead(userId, { ids } = {}) {
    const condition =
        Array.isArray(ids) && ids.length > 0
            ? and(eq(notifications.recipientUserId, userId), inArray(notifications.id, ids), isNull(notifications.readAt))
            : and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt));

    await db.update(notifications).set({ readAt: new Date() }).where(condition);
}

function unsubscribeSecret() {
    const secret = process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    if (!secret) throw new Error('Missing NOTIFICATIONS_UNSUBSCRIBE_SECRET env var');
    return secret;
}

export function buildUnsubscribeToken(userUuid) {
    return createHmac('sha256', unsubscribeSecret()).update(String(userUuid)).digest('base64url');
}

export function verifyUnsubscribeToken(userUuid, token) {
    if (!token) return false;

    const expected = Buffer.from(buildUnsubscribeToken(userUuid));
    const provided = Buffer.from(String(token));
    if (expected.length !== provided.length) return false;

    return timingSafeEqual(expected, provided);
}

export async function unsubscribeFromEmailDigest({ userUuid, token }) {
    if (!verifyUnsubscribeToken(userUuid, token)) {
        throw new Error('Invalid or expired unsubscribe link');
    }

    const userRows = await db.select({ id: users.id }).from(users).where(eq(users.uuid, userUuid));
    const user = userRows[0];
    if (!user) {
        throw new Error('Invalid or expired unsubscribe link');
    }

    await db
        .insert(notificationPreferences)
        .values({ userId: user.id, ...NOTIFICATION_PREFERENCE_DEFAULTS, emailDigestEnabled: false })
        .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { emailDigestEnabled: false, updatedAt: new Date() }
        });
}
