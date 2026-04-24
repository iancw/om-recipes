'use server';

import { db } from '../../db/index.ts';
import { authors } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearSessionCookie, findOrCreateAuthorForUser, requireUser } from '../../lib/auth.js';
import { startAccountDeletion, startPrivacyExport } from '../../lib/privacy.js';

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
        email: session.user.email,
        displayName: name
    });

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
