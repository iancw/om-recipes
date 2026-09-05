'use server';

import { db } from '../../db/index.ts';
import { authors, recipes } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearSessionCookie, findOrCreateAuthorForUser, requireUser } from '../../lib/auth.js';
import { upsertNotificationPreferences } from '../../lib/notifications.js';
import { startAccountDeletion, startPrivacyExport } from '../../lib/privacy.js';
import { revalidatePublicRecipeCatalog, revalidateRecipeDetail } from '../../lib/public-recipe-catalog-cache.js';
import { reconcileUserStateBestEffort } from '../../lib/user-state-flush.js';
import { addAuthorIdToUserState, setUserStatePreferences } from '../../lib/user-state-cache.js';

function normalizeOptionalUrl(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return s;
}

export async function updateMyProfileAction(formData) {
    const session = await requireUser();

    const name = String(formData?.get('name') ?? '').trim();
    if (!name) throw new Error('Name is required');

    const instagramLink = normalizeOptionalUrl(formData?.get('instagramLink'));
    const flickrLink = normalizeOptionalUrl(formData?.get('flickrLink'));
    const website = normalizeOptionalUrl(formData?.get('website'));
    const hasKofiLink = formData?.has('kofiLink');
    const kofiLink = hasKofiLink ? normalizeOptionalUrl(formData?.get('kofiLink')) : undefined;

    const author = await findOrCreateAuthorForUser({
        userId: session.user.id,
        displayName: name
    });
    await addAuthorIdToUserState(session.user.uuid, author.id);

    await db
        .update(authors)
        .set({
            name,
            instagramLink,
            flickrLink,
            website,
            ...(hasKofiLink ? { kofiLink } : {}),
            updatedAt: new Date()
        })
        .where(eq(authors.id, author.id));

    await revalidatePublicRecipeCatalog();
    const authoredRecipeRows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.authorId, author.id));
    await Promise.all(authoredRecipeRows.map((row) => revalidateRecipeDetail(row.id)));
    revalidatePath('/profile');
}

export async function requestMyDataExportAction() {
    const session = await requireUser();

    await startPrivacyExport({
        userId: session.user.id,
        userUuid: session.user.uuid
    });

    revalidatePath('/profile');
}

export async function updateMyNotificationPreferencesAction(formData) {
    const session = await requireUser();

    const preferences = {
        notifyNewRecipe: formData?.has('notifyNewRecipe'),
        notifySampleImage: formData?.has('notifySampleImage'),
        notifySave: formData?.has('notifySave'),
        notifyComment: formData?.has('notifyComment'),
        emailDigestEnabled: formData?.has('emailDigestEnabled')
    };

    await upsertNotificationPreferences(session.user.id, preferences);
    await setUserStatePreferences(session.user.uuid, preferences);

    revalidatePath('/profile');
    await reconcileUserStateBestEffort(session.user.uuid);
}

export async function deleteMyAccountAction(formData) {
    const session = await requireUser();
    const confirmation = String(formData?.get('confirmation') ?? '').trim();

    if (confirmation !== 'DELETE') {
        throw new Error('Type DELETE to confirm account deletion');
    }

    await startAccountDeletion({
        userId: session.user.id,
        userUuid: session.user.uuid
    });

    await clearSessionCookie();
    redirect('/login?deleted=1');
}
