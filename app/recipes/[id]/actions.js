'use server';

import { db } from '../../../db/index.ts';
import {
    authors,
    comments,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipes,
    users
} from '../../../db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { findOrCreateAuthorForUser, requireUser } from '../../../lib/auth.js';
import { getRecipePath } from '../../../lib/recipe-url.js';
import { applySlugChange, computeSlugBase, resolveUniqueSlug } from '../../../lib/recipe-slug.js';
import { revalidatePublicRecipeCatalog } from '../../../lib/public-recipe-catalog-cache.js';
import { addComment, deleteComment } from '../../../lib/comments.js';
import { notifyRecipeCommented } from '../../../lib/notifications.js';

import {
    computeRecipeFingerprint,
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeMonoFingerprint,
    computeMonoNoWbFingerprint,
    computeMonoToneFingerprint,
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

function getRecipeTypeConfig(recipeType) {
    if (recipeType === 'MONO') {
        return {
            recipeType: 'MONO',
            settingsTable: recipeMonoSettings,
            selectShape: {
                monochromeProfile: recipeMonoSettings.monochromeProfile,
                monochromeColor: recipeMonoSettings.monochromeColor,
                monochromeColorStrength: recipeMonoSettings.monochromeColorStrength,
                filmGrain: recipeMonoSettings.filmGrain,
                filmHue: recipeMonoSettings.filmHue,
                monochromeVignetting: recipeMonoSettings.monochromeVignetting,
                contrast: recipeMonoSettings.contrast,
                sharpness: recipeMonoSettings.sharpness,
                highlights: recipeMonoSettings.highlights,
                shadows: recipeMonoSettings.shadows,
                midtones: recipeMonoSettings.midtones,
                shadingEffect: recipeMonoSettings.shadingEffect,
                exposureCompensation: recipeMonoSettings.exposureCompensation,
                whiteBalance2: recipeMonoSettings.whiteBalance2,
                whiteBalanceTemperature: recipeMonoSettings.whiteBalanceTemperature,
                whiteBalanceAmberOffset: recipeMonoSettings.whiteBalanceAmberOffset,
                whiteBalanceGreenOffset: recipeMonoSettings.whiteBalanceGreenOffset
            },
            computeFingerprints(settings) {
                return {
                    recipeFingerprint: computeRecipeFingerprint(settings),
                    genericFingerprint: computeMonoFingerprint(settings),
                    genericToneFingerprint: computeMonoToneFingerprint(settings),
                    genericNoWbFingerprint: computeMonoNoWbFingerprint(settings),
                    childFingerprintValues: {
                        recipeFingerprint: computeRecipeFingerprint(settings),
                        monoFingerprint: computeMonoFingerprint(settings),
                        monoToneFingerprint: computeMonoToneFingerprint(settings),
                        monoNoWbFingerprint: computeMonoNoWbFingerprint(settings)
                    }
                };
            }
        };
    }

    return {
        recipeType: 'COLOR',
        settingsTable: recipeColorSettings,
        selectShape: {
            yellow: recipeColorSettings.yellow,
            orange: recipeColorSettings.orange,
            orangeRed: recipeColorSettings.orangeRed,
            red: recipeColorSettings.red,
            magenta: recipeColorSettings.magenta,
            violet: recipeColorSettings.violet,
            blue: recipeColorSettings.blue,
            blueCyan: recipeColorSettings.blueCyan,
            cyan: recipeColorSettings.cyan,
            greenCyan: recipeColorSettings.greenCyan,
            green: recipeColorSettings.green,
            yellowGreen: recipeColorSettings.yellowGreen,
            contrast: recipeColorSettings.contrast,
            sharpness: recipeColorSettings.sharpness,
            highlights: recipeColorSettings.highlights,
            shadows: recipeColorSettings.shadows,
            midtones: recipeColorSettings.midtones,
            shadingEffect: recipeColorSettings.shadingEffect,
            exposureCompensation: recipeColorSettings.exposureCompensation,
            whiteBalance2: recipeColorSettings.whiteBalance2,
            whiteBalanceTemperature: recipeColorSettings.whiteBalanceTemperature,
            whiteBalanceAmberOffset: recipeColorSettings.whiteBalanceAmberOffset,
            whiteBalanceGreenOffset: recipeColorSettings.whiteBalanceGreenOffset
        },
        computeFingerprints(settings) {
            return {
                recipeFingerprint: computeRecipeFingerprint(settings),
                genericFingerprint: computeColorFingerprint(settings),
                genericToneFingerprint: computeColorToneFingerprint(settings),
                genericNoWbFingerprint: computeNoWbFingerprint(settings),
                childFingerprintValues: {
                    recipeFingerprint: computeRecipeFingerprint(settings),
                    colorFingerprint: computeColorFingerprint(settings),
                    colorToneFingerprint: computeColorToneFingerprint(settings),
                    noWbFingerprint: computeNoWbFingerprint(settings)
                }
            };
        }
    };
}

function buildLegacyRecipeMirrorValues({ recipeType, settings, fingerprints }) {
    return {
        yellow: recipeType === 'COLOR' ? settings.yellow ?? null : null,
        orange: recipeType === 'COLOR' ? settings.orange ?? null : null,
        orangeRed: recipeType === 'COLOR' ? settings.orangeRed ?? null : null,
        red: recipeType === 'COLOR' ? settings.red ?? null : null,
        magenta: recipeType === 'COLOR' ? settings.magenta ?? null : null,
        violet: recipeType === 'COLOR' ? settings.violet ?? null : null,
        blue: recipeType === 'COLOR' ? settings.blue ?? null : null,
        blueCyan: recipeType === 'COLOR' ? settings.blueCyan ?? null : null,
        cyan: recipeType === 'COLOR' ? settings.cyan ?? null : null,
        greenCyan: recipeType === 'COLOR' ? settings.greenCyan ?? null : null,
        green: recipeType === 'COLOR' ? settings.green ?? null : null,
        yellowGreen: recipeType === 'COLOR' ? settings.yellowGreen ?? null : null,
        contrast: settings.contrast ?? null,
        sharpness: settings.sharpness ?? null,
        highlights: settings.highlights ?? null,
        shadows: settings.shadows ?? null,
        midtones: settings.midtones ?? null,
        shadingEffect: settings.shadingEffect ?? 0,
        exposureCompensation: settings.exposureCompensation ?? 0,
        whiteBalance2: settings.whiteBalance2 ?? null,
        whiteBalanceTemperature: settings.whiteBalanceTemperature ?? null,
        whiteBalanceAmberOffset: settings.whiteBalanceAmberOffset ?? null,
        whiteBalanceGreenOffset: settings.whiteBalanceGreenOffset ?? null,
        recipeFingerprint: fingerprints.recipeFingerprint,
        colorFingerprint: fingerprints.genericFingerprint,
        colorToneFingerprint: fingerprints.genericToneFingerprint,
        noWbFingerprint: fingerprints.genericNoWbFingerprint
    };
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
            type: recipes.type,
            authorName: recipes.authorName
        })
        .from(recipes)
        .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
        .limit(1);

    if (existing.length === 0) throw new Error('Not authorized');

    const recipeType = existing[0].type;
    const typeConfig = getRecipeTypeConfig(recipeType);
    const settingsRows = await db
        .select(typeConfig.selectShape)
        .from(typeConfig.settingsTable)
        .where(eq(typeConfig.settingsTable.recipeId, recipeId))
        .limit(1);

    if (settingsRows.length === 0) {
        throw new Error('Recipe settings not found');
    }

    const fingerprintSource = {
        recipeType,
        ...settingsRows[0]
    };
    const fingerprints = typeConfig.computeFingerprints(fingerprintSource);

    await db
        .update(typeConfig.settingsTable)
        .set(fingerprints.childFingerprintValues)
        .where(eq(typeConfig.settingsTable.recipeId, recipeId));

    const updated = await db
        .update(recipes)
        .set({
            recipeName,
            description: isBlank(description) ? null : description,
            sourceUrl,
            ...buildLegacyRecipeMirrorValues({
                recipeType,
                settings: settingsRows[0],
                fingerprints
            }),
            updatedAt: new Date()
        })
        .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
        .returning({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug });

    const r = updated[0];

    const oldSlug = existing[0].slug;
    const base = computeSlugBase({ authorName: existing[0].authorName, recipeName });
    const newSlug = await resolveUniqueSlug({ base, recipeId });
    const slugResult = await applySlugChange({ recipeId, oldSlug, newSlug });

    if (r) await revalidatePublicRecipeCatalog();
    revalidatePath(getRecipePath({ slug: oldSlug }));
    if (slugResult.changed) {
        revalidatePath(getRecipePath({ slug: slugResult.newSlug }));
    }
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

    if (deleted.length > 0) await revalidatePublicRecipeCatalog();
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

    await revalidatePublicRecipeCatalog();
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

    await revalidatePublicRecipeCatalog();
    const recipe = recipeRows[0];
    revalidatePath(getRecipePath(recipe));
    revalidatePath('/');
}

export async function addCommentAction({ recipeId, body }) {
    const session = await requireUser();

    const parsedRecipeId = Number(recipeId);
    if (!Number.isFinite(parsedRecipeId)) throw new Error('Invalid recipe id');

    const recipeRows = await db
        .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug })
        .from(recipes)
        .where(eq(recipes.id, parsedRecipeId))
        .limit(1);
    if (recipeRows.length === 0) throw new Error('Recipe not found');
    const recipe = recipeRows[0];

    const userRows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

    let author;
    try {
        author = await findOrCreateAuthorForUser({ userId: session.user.id, email: userRows[0]?.email });
    } catch (err) {
        return { ok: false, error: err?.message || 'Unable to post comment right now' };
    }

    let comment;
    try {
        comment = await addComment({ recipeId: parsedRecipeId, authorId: author.id, body });
    } catch (err) {
        // Expected, user-facing validation failures (blank body, over-length body,
        // the spam cooldown) are returned as data rather than thrown: Next.js
        // redacts thrown Server Action error messages in production builds, which
        // would leave the user staring at framework boilerplate instead of the
        // reason their comment did not post.
        return { ok: false, error: err?.message || 'Failed to post comment' };
    }

    await notifyRecipeCommented(parsedRecipeId, comment.id, author.id);

    revalidatePath(getRecipePath(recipe));

    return { ok: true };
}

export async function deleteCommentAction({ recipeId, commentId }) {
    const session = await requireUser();

    const parsedRecipeId = Number(recipeId);
    const parsedCommentId = Number(commentId);
    if (!Number.isFinite(parsedRecipeId)) throw new Error('Invalid recipe id');
    if (!Number.isFinite(parsedCommentId)) throw new Error('Invalid comment id');

    const recipeRows = await db
        .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug, authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, parsedRecipeId))
        .limit(1);
    if (recipeRows.length === 0) throw new Error('Recipe not found');
    const recipe = recipeRows[0];

    const commentRows = await db
        .select({ recipeId: comments.recipeId })
        .from(comments)
        .where(eq(comments.id, parsedCommentId))
        .limit(1);
    if (commentRows.length === 0 || commentRows[0].recipeId !== parsedRecipeId) {
        throw new Error('Comment not found');
    }

    const authorRows = await db.select({ id: authors.id }).from(authors).where(eq(authors.userId, session.user.id));
    const requestingAuthorIds = authorRows.map((row) => row.id);

    await deleteComment({ commentId: parsedCommentId, requestingAuthorIds, recipeAuthorId: recipe.authorId });

    revalidatePath(getRecipePath(recipe));
}
