'use server';

import { db } from '../../../db/index.ts';
import { authors, recipeComparisonImages, recipeSampleImages, recipes } from '../../../db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth.js';
import { getRecipePath } from '../../../lib/recipe-url.js';

import {
    computeRecipeFingerprint,
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeNoWbFingerprint
} from '../../../lib/recipeFingerprint.js';
import { deleteOrphanedImagesByIds } from '../../../lib/oci/deleteOrphanedImages.js';

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function normalizeOptionalUrl(value) {
    if (isBlank(value)) return null;
    const raw = String(value).trim();

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('Source URL must be a valid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Source URL must start with http:// or https://');
    }

    return parsed.toString();
}

export async function updateRecipeAction(formData) {
    const session = await requireUser();

    const recipeId = Number(formData?.get('recipeId'));
    if (!Number.isFinite(recipeId)) throw new Error('Invalid recipe id');

    const recipeName = String(formData?.get('recipeName') ?? '').trim();
    const description = String(formData?.get('description') ?? '').trim();
    const sourceUrl = normalizeOptionalUrl(formData?.get('sourceUrl'));
    if (isBlank(recipeName)) throw new Error('Recipe name is required');

    const authorRow = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, session.user.id));
    if (authorRow.length === 0) throw new Error('Author record not found');

    const authorIds = authorRow.map((row) => row.id);

    // Load existing settings so we can keep the fingerprint in sync even if the
    // edit UI only updates name/description.
    const existing = await db
        .select({
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,

            yellow: recipes.yellow,
            orange: recipes.orange,
            orangeRed: recipes.orangeRed,
            red: recipes.red,
            magenta: recipes.magenta,
            violet: recipes.violet,
            blue: recipes.blue,
            blueCyan: recipes.blueCyan,
            cyan: recipes.cyan,
            greenCyan: recipes.greenCyan,
            green: recipes.green,
            yellowGreen: recipes.yellowGreen,

            contrast: recipes.contrast,
            sharpness: recipes.sharpness,
            highlights: recipes.highlights,
            shadows: recipes.shadows,
            midtones: recipes.midtones,

            whiteBalance2: recipes.whiteBalance2,
            whiteBalanceTemperature: recipes.whiteBalanceTemperature,
            whiteBalanceAmberOffset: recipes.whiteBalanceAmberOffset,
            whiteBalanceGreenOffset: recipes.whiteBalanceGreenOffset
        })
        .from(recipes)
        .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
        .limit(1);

    if (existing.length === 0) throw new Error('Not authorized');

    const recipeFingerprint = computeRecipeFingerprint(existing[0]);
    const colorFingerprint = computeColorFingerprint(existing[0]);
    const colorToneFingerprint = computeColorToneFingerprint(existing[0]);
    const noWbFingerprint = computeNoWbFingerprint(existing[0]);

    const updated = await db
        .update(recipes)
        .set({
            recipeName,
            description: isBlank(description) ? null : description,
            sourceUrl,
            recipeFingerprint,
            colorFingerprint,
            colorToneFingerprint,
            noWbFingerprint,
            updatedAt: new Date()
        })
        .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
        .returning({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug });

    const r = updated[0];
    revalidatePath(getRecipePath(r));
}

export async function deleteMyRecipeAction(formData) {
    const recipeIdRaw = formData?.get('recipeId');
    const recipeId = Number(recipeIdRaw);
    const confirmName = String(formData?.get('confirmName') ?? '').trim();

    const session = await requireUser();
    if (!Number.isFinite(recipeId)) throw new Error('Invalid recipe id');

    const authorRows = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, session.user.id));

    if (authorRows.length === 0) throw new Error('Author record not found');
    const authorIds = authorRows.map((row) => row.id);

    const recipeRows = await db
        .select({ id: recipes.id, authorId: recipes.authorId, recipeName: recipes.recipeName })
        .from(recipes)
        .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
        .limit(1);

    if (recipeRows.length === 0) throw new Error('Recipe not found');

    const recipeRow = recipeRows[0];
    if (!confirmName || confirmName !== recipeRow.recipeName) {
        throw new Error('Confirmation text did not match recipe name');
    }

    const [sampleImageIds, comparisonImageIds] = await Promise.all([
        db
            .select({ imageId: recipeSampleImages.imageId })
            .from(recipeSampleImages)
            .where(eq(recipeSampleImages.recipeId, recipeId)),
        db
            .select({ imageId: recipeComparisonImages.imageId })
            .from(recipeComparisonImages)
            .where(eq(recipeComparisonImages.recipeId, recipeId))
    ]);

    const associatedImageIds = Array.from(
        new Set(
            [...sampleImageIds, ...comparisonImageIds]
                .map((row) => row.imageId)
                .filter((value) => value != null)
        )
    );

    const deleted = await db.delete(recipes).where(eq(recipes.id, recipeId)).returning({ id: recipes.id });

    if (deleted.length > 0 && associatedImageIds.length > 0) {
        await deleteOrphanedImagesByIds(associatedImageIds);
    }

    revalidatePath('/');
    redirect('/');
}

export async function deleteRecipeSampleImageAction({ recipeId, imageId }) {
    const session = await requireUser();

    const parsedRecipeId = Number(recipeId);
    const parsedImageId = Number(imageId);
    if (!Number.isFinite(parsedRecipeId)) throw new Error('Invalid recipe id');
    if (!Number.isFinite(parsedImageId)) throw new Error('Invalid image id');

    const authorRow = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, session.user.id));
    if (authorRow.length === 0) throw new Error('Author record not found');

    const ownerAuthorIds = authorRow.map((row) => row.id);

    const recipeRows = await db
        .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug })
        .from(recipes)
        .where(and(eq(recipes.id, parsedRecipeId), inArray(recipes.authorId, ownerAuthorIds)))
        .limit(1);
    if (recipeRows.length === 0) throw new Error('Not authorized');

    const deleted = await db
        .delete(recipeSampleImages)
        .where(and(eq(recipeSampleImages.recipeId, parsedRecipeId), eq(recipeSampleImages.imageId, parsedImageId)))
        .returning({ imageId: recipeSampleImages.imageId });

    if (deleted.length === 0) {
        throw new Error('Sample image not found');
    }

    await deleteOrphanedImagesByIds([parsedImageId]);

    const recipe = recipeRows[0];
    revalidatePath(getRecipePath(recipe));
    revalidatePath('/');
    revalidatePath('/my-samples');
}

export async function setPrimaryRecipeSampleImageAction({ recipeId, imageId }) {
    const session = await requireUser();

    const parsedRecipeId = Number(recipeId);
    const parsedImageId = Number(imageId);
    if (!Number.isFinite(parsedRecipeId)) throw new Error('Invalid recipe id');
    if (!Number.isFinite(parsedImageId)) throw new Error('Invalid image id');

    const authorRow = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, session.user.id));
    if (authorRow.length === 0) throw new Error('Author record not found');

    const ownerAuthorIds = authorRow.map((row) => row.id);

    const recipeRows = await db
        .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug })
        .from(recipes)
        .where(and(eq(recipes.id, parsedRecipeId), inArray(recipes.authorId, ownerAuthorIds)))
        .limit(1);
    if (recipeRows.length === 0) throw new Error('Not authorized');

    const sampleRows = await db
        .select({ imageId: recipeSampleImages.imageId })
        .from(recipeSampleImages)
        .where(and(eq(recipeSampleImages.recipeId, parsedRecipeId), eq(recipeSampleImages.imageId, parsedImageId)))
        .limit(1);
    if (sampleRows.length === 0) {
        throw new Error('Sample image not found');
    }

    await db
        .update(recipeSampleImages)
        .set({ isPrimary: false })
        .where(eq(recipeSampleImages.recipeId, parsedRecipeId));

    await db
        .update(recipeSampleImages)
        .set({ isPrimary: true })
        .where(and(eq(recipeSampleImages.recipeId, parsedRecipeId), eq(recipeSampleImages.imageId, parsedImageId)));

    const recipe = recipeRows[0];
    revalidatePath(getRecipePath(recipe));
    revalidatePath('/');
}
