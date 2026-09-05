import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authors, comments, notificationPreferences, notifications, recipes, users } from '../db/schema.ts';
import { publicAppBaseUrl } from './auth-url.js';
import { appendNotificationToUserState, getUserSavedState } from './user-state-cache.js';

export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
    notifyNewRecipe: false,
    notifySampleImage: true,
    notifySave: true,
    notifyComment: true,
    emailDigestEnabled: false
});

export async function getEffectivePreferences(userId) {
    const rows = await db
        .select({
            notifyNewRecipe: notificationPreferences.notifyNewRecipe,
            notifySampleImage: notificationPreferences.notifySampleImage,
            notifySave: notificationPreferences.notifySave,
            notifyComment: notificationPreferences.notifyComment,
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
        notifyComment: Boolean(values?.notifyComment),
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

export function commentDedupeKey(commentId) {
    return `comment:${commentId}`;
}

export function commentParticipantDedupeKey(commentId, recipientUserId) {
    return `comment:${commentId}:${recipientUserId}`;
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
            ownerUserId: authors.userId,
            ownerUuid: users.uuid
        })
        .from(recipes)
        .innerJoin(authors, eq(authors.id, recipes.authorId))
        .leftJoin(users, eq(users.id, authors.userId))
        .where(eq(recipes.id, recipeId))
        .limit(1);

    return rows[0] ?? null;
}

async function getRecipeMetaForNotification(recipeId) {
    const { getRecipeIndex } = await import('./public-recipe-catalog.js');
    const index = await getRecipeIndex();
    const entry = index.find((item) => item.id === recipeId);
    return { recipeSlug: entry?.slug ?? null, recipeName: entry?.recipeName ?? null };
}

async function getAuthorName(authorId) {
    if (authorId == null) return null;
    const rows = await db.select({ name: authors.name }).from(authors).where(eq(authors.id, authorId)).limit(1);
    return rows[0]?.name ?? null;
}

async function getUuidsForUserIds(userIds) {
    const uniqueIds = [...new Set(userIds)].filter((id) => id != null);
    if (uniqueIds.length === 0) return new Map();

    const rows = await db.select({ id: users.id, uuid: users.uuid }).from(users).where(inArray(users.id, uniqueIds));
    return new Map(rows.map((row) => [row.id, row.uuid]));
}

export async function notifyRecipeSaved(recipeId, saverUserId) {
    await withFailureIsolation('notifyRecipeSaved', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId || !owner.ownerUuid) return;
        if (owner.ownerUserId === saverUserId) return;

        // The owner's own blob, not Postgres — matches the save-toggle route's
        // rule that this request makes no Postgres call at all.
        const ownerState = await getUserSavedState(owner.ownerUuid, owner.ownerUserId);
        if (!ownerState.preferences?.notifySave) return;

        const saverAuthorRows = await db
            .select({ name: authors.name })
            .from(authors)
            .where(eq(authors.userId, saverUserId))
            .orderBy(asc(authors.id))
            .limit(1);
        const actorAuthorName = saverAuthorRows[0]?.name ?? null;

        const meta = await getRecipeMetaForNotification(recipeId);
        await appendNotificationToUserState(owner.ownerUuid, owner.ownerUserId, {
            type: 'recipe_saved',
            recipeId,
            recipeSlug: meta.recipeSlug,
            recipeName: meta.recipeName,
            actorAuthorName,
            sampleImageId: null,
            dedupeKey: saveDedupeKey(recipeId, saverUserId)
        });
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

        if (owner.ownerUuid) {
            const [meta, actorAuthorName] = await Promise.all([
                getRecipeMetaForNotification(recipeId),
                getAuthorName(contributorAuthorId)
            ]);
            await appendNotificationToUserState(owner.ownerUuid, owner.ownerUserId, {
                type: 'sample_image_added',
                recipeId,
                recipeSlug: meta.recipeSlug,
                recipeName: meta.recipeName,
                actorAuthorName,
                sampleImageId,
                dedupeKey: sampleImageDedupeKey(sampleImageId)
            });
        }
    });
}

async function getAuthorUserId(authorId) {
    const rows = await db
        .select({ userId: authors.userId })
        .from(authors)
        .where(eq(authors.id, authorId))
        .limit(1);
    return rows[0]?.userId ?? null;
}

async function getCommentParticipantUserIds(recipeId) {
    const rows = await db
        .select({ userId: authors.userId })
        .from(comments)
        .innerJoin(authors, eq(authors.id, comments.authorId))
        .where(and(eq(comments.recipeId, recipeId), isNotNull(authors.userId)));

    return [...new Set(rows.map((row) => row.userId).filter((userId) => userId != null))];
}

async function filterUsersWithCommentNotifications(userIds) {
    if (userIds.length === 0) return [];

    const rows = await db
        .select({
            userId: notificationPreferences.userId,
            notifyComment: notificationPreferences.notifyComment
        })
        .from(notificationPreferences)
        .where(inArray(notificationPreferences.userId, userIds));

    const prefByUser = new Map(rows.map((row) => [row.userId, row.notifyComment]));
    return userIds.filter(
        (userId) => (prefByUser.get(userId) ?? NOTIFICATION_PREFERENCE_DEFAULTS.notifyComment) !== false
    );
}

export async function notifyRecipeCommented(recipeId, commentId, commenterAuthorId) {
    await withFailureIsolation('notifyRecipeCommented', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId) return;

        const commenterUserId = await getAuthorUserId(commenterAuthorId);

        let metaPromise;
        const resolveMeta = () => (metaPromise ??= getRecipeMetaForNotification(recipeId));
        let actorNamePromise;
        const resolveActorName = () => (actorNamePromise ??= getAuthorName(commenterAuthorId));

        // Notify the recipe owner that someone commented on their recipe.
        if (owner.authorId !== commenterAuthorId) {
            const prefs = await getEffectivePreferences(owner.ownerUserId);
            if (prefs.notifyComment) {
                await db
                    .insert(notifications)
                    .values({
                        recipientUserId: owner.ownerUserId,
                        type: 'comment',
                        recipeId,
                        actorAuthorId: commenterAuthorId,
                        dedupeKey: commentDedupeKey(commentId)
                    })
                    .onConflictDoNothing();

                if (owner.ownerUuid) {
                    const [meta, actorAuthorName] = await Promise.all([resolveMeta(), resolveActorName()]);
                    await appendNotificationToUserState(owner.ownerUuid, owner.ownerUserId, {
                        type: 'comment',
                        recipeId,
                        recipeSlug: meta.recipeSlug,
                        recipeName: meta.recipeName,
                        actorAuthorName,
                        sampleImageId: null,
                        dedupeKey: commentDedupeKey(commentId)
                    });
                }
            }
        }

        // Notify everyone else who has commented on this recipe, so they can
        // follow replies to threads they took part in. The owner is already
        // covered above; the new commenter is never notified about their own
        // comment.
        const participantUserIds = (await getCommentParticipantUserIds(recipeId)).filter(
            (userId) => userId !== owner.ownerUserId && userId !== commenterUserId
        );
        const recipientUserIds = await filterUsersWithCommentNotifications(participantUserIds);
        if (recipientUserIds.length === 0) return;

        await db
            .insert(notifications)
            .values(
                recipientUserIds.map((recipientUserId) => ({
                    recipientUserId,
                    type: 'comment',
                    recipeId,
                    actorAuthorId: commenterAuthorId,
                    dedupeKey: commentParticipantDedupeKey(commentId, recipientUserId)
                }))
            )
            .onConflictDoNothing();

        const [meta, actorAuthorName, uuidByUserId] = await Promise.all([
            resolveMeta(),
            resolveActorName(),
            getUuidsForUserIds(recipientUserIds)
        ]);

        await Promise.all(
            recipientUserIds.map((recipientUserId) => {
                const recipientUuid = uuidByUserId.get(recipientUserId);
                if (!recipientUuid) return null;
                return appendNotificationToUserState(recipientUuid, recipientUserId, {
                    type: 'comment',
                    recipeId,
                    recipeSlug: meta.recipeSlug,
                    recipeName: meta.recipeName,
                    actorAuthorName,
                    sampleImageId: null,
                    dedupeKey: commentParticipantDedupeKey(commentId, recipientUserId)
                });
            })
        );
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

        const [meta, actorAuthorName, uuidByUserId] = await Promise.all([
            getRecipeMetaForNotification(recipeId),
            getAuthorName(owner.authorId),
            getUuidsForUserIds(recipientUserIds)
        ]);

        await Promise.all(
            recipientUserIds.map((recipientUserId) => {
                const recipientUuid = uuidByUserId.get(recipientUserId);
                if (!recipientUuid) return null;
                return appendNotificationToUserState(recipientUuid, recipientUserId, {
                    type: 'new_recipe',
                    recipeId,
                    recipeSlug: meta.recipeSlug,
                    recipeName: meta.recipeName,
                    actorAuthorName,
                    sampleImageId: null,
                    dedupeKey: newRecipeDedupeKey(recipeId, recipientUserId)
                });
            })
        );
    });
}

export async function getNotificationsForUser(userId, { limit = 50 } = {}) {
    return db
        .select({
            id: notifications.id,
            uuid: notifications.uuid,
            type: notifications.type,
            dedupeKey: notifications.dedupeKey,
            sampleImageId: notifications.sampleImageId,
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
    if (counts.comment) parts.push(pluralize(counts.comment, 'comment'));
    if (counts.recipe_saved) parts.push(pluralize(counts.recipe_saved, 'save'));
    if (counts.sample_image_added) parts.push(`${pluralize(counts.sample_image_added, 'new sample image')} on your recipes`);
    if (counts.new_recipe) parts.push(pluralize(counts.new_recipe, 'new recipe'));
    return parts.join(', ');
}

export function buildDigestEmail({ counts, uuid }) {
    const summary = summarizeDigestCounts(counts);
    const baseUrl = publicAppBaseUrl();
    const token = buildUnsubscribeToken(uuid);
    const unsubscribeUrl = `${baseUrl}/notifications/unsubscribe?uid=${encodeURIComponent(uuid)}&token=${encodeURIComponent(token)}`;
    const manageUrl = `${baseUrl}/profile`;

    return {
        subject: `Today on OM Recipes: ${summary}`,
        text: `Today on OM Recipes: ${summary}.\n\nView your notifications: ${baseUrl}\n\nUnsubscribe from this digest: ${unsubscribeUrl}\nManage preferences: ${manageUrl}`,
        html: `<p>Today on OM Recipes: ${summary}.</p><p><a href="${baseUrl}">View your notifications</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a> · <a href="${manageUrl}">Manage preferences</a></p>`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` }
    };
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

    const { sendEmail } = await import('./oci/emailDelivery.js');
    await sendEmail({ to: email, ...buildDigestEmail({ counts, uuid }) });

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

export async function reconcileNotificationsForUser({ userId, notifications: cachedNotifications }) {
    if (!cachedNotifications || cachedNotifications.length === 0) return;

    const rowsToInsert = cachedNotifications.map((entry) => ({
        recipientUserId: userId,
        type: entry.type,
        recipeId: entry.recipeId,
        actorAuthorId: null,
        sampleImageId: entry.sampleImageId ?? null,
        dedupeKey: entry.dedupeKey
    }));

    await db.insert(notifications).values(rowsToInsert).onConflictDoNothing();

    const readDedupeKeys = cachedNotifications
        .filter((entry) => entry.readAt != null)
        .map((entry) => entry.dedupeKey);

    if (readDedupeKeys.length === 0) return;

    await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(inArray(notifications.dedupeKey, readDedupeKeys), isNull(notifications.readAt)));
}
