import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authors, notificationPreferences, notifications, recipes, users } from '../db/schema.ts';
import { publicAppBaseUrl } from './auth-url.js';

export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
    notifyNewRecipe: false,
    notifySampleImage: true,
    notifySave: true,
    emailDigestEnabled: false
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

export function isSixPmEastern(date = new Date()) {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false
    }).format(date);

    return Number(hour) === 18;
}

export async function getUsersEligibleForDigest() {
    return db
        .selectDistinct({
            userId: users.id,
            uuid: users.uuid,
            email: users.email
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientUserId))
        .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
        .where(
            and(
                isNull(notifications.emailedAt),
                isNotNull(users.emailVerifiedAt),
                eq(notificationPreferences.emailDigestEnabled, true)
            )
        );
}

function pluralize(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function summarizeDigestCounts(counts) {
    const parts = [];
    if (counts.recipe_saved) parts.push(pluralize(counts.recipe_saved, 'save'));
    if (counts.sample_image_added) parts.push(`${pluralize(counts.sample_image_added, 'new sample image')} on your recipes`);
    if (counts.new_recipe) parts.push(pluralize(counts.new_recipe, 'new recipe'));
    return parts.join(', ');
}

export async function sendDailyDigestForUser({ userId, uuid, email }) {
    const pending = await db
        .select({ id: notifications.id, type: notifications.type })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.emailedAt)));

    if (pending.length === 0) return { sent: false, count: 0 };

    const counts = pending.reduce((acc, row) => {
        acc[row.type] = (acc[row.type] ?? 0) + 1;
        return acc;
    }, {});
    const summary = summarizeDigestCounts(counts);

    const baseUrl = publicAppBaseUrl();
    const token = buildUnsubscribeToken(uuid);
    const unsubscribeUrl = `${baseUrl}/notifications/unsubscribe?uid=${encodeURIComponent(uuid)}&token=${encodeURIComponent(token)}`;
    const manageUrl = `${baseUrl}/profile`;

    const { sendEmail } = await import('./oci/emailDelivery.js');
    await sendEmail({
        to: email,
        subject: `Today on OM Recipes: ${summary}`,
        text: `Today on OM Recipes: ${summary}.\n\nView your notifications: ${baseUrl}\n\nUnsubscribe from this digest: ${unsubscribeUrl}\nManage preferences: ${manageUrl}`,
        html: `<p>Today on OM Recipes: ${summary}.</p><p><a href="${baseUrl}">View your notifications</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a> · <a href="${manageUrl}">Manage preferences</a></p>`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` }
    });

    await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(
            and(
                eq(notifications.recipientUserId, userId),
                inArray(notifications.id, pending.map((row) => row.id))
            )
        );

    return { sent: true, count: pending.length };
}

export async function runDailyDigest() {
    const eligible = await getUsersEligibleForDigest();
    let sent = 0;
    let failed = 0;

    for (const user of eligible) {
        try {
            const result = await sendDailyDigestForUser(user);
            if (result.sent) sent += 1;
        } catch (error) {
            failed += 1;
            console.error('[notifications] digest send failed', { userId: user.userId, error });
        }
    }

    return { eligibleUsers: eligible.length, sent, failed };
}
