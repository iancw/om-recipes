'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '../../db/index.ts';
import { authors, recipeSampleImages, recipes } from '../../db/schema.ts';
import { requireUser } from '../../lib/auth.js';
import { getRecipePath } from '../../lib/recipe-url.js';
import { deleteOrphanedImagesByIds } from '../../lib/oci/deleteOrphanedImages.js';

export async function deleteMySampleImageAction({ recipeId, imageId }) {
    const session = await requireUser();

    const parsedRecipeId = Number(recipeId);
    const parsedImageId = Number(imageId);
    if (!Number.isFinite(parsedRecipeId)) throw new Error('Invalid recipe id');
    if (!Number.isFinite(parsedImageId)) throw new Error('Invalid image id');

    const authorRows = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, session.user.id));
    if (authorRows.length === 0) throw new Error('Author record not found');

    const uploaderAuthorIds = authorRows.map((row) => row.id);

    const recipeRows = await db
        .select({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug })
        .from(recipes)
        .where(eq(recipes.id, parsedRecipeId))
        .limit(1);
    if (recipeRows.length === 0) throw new Error('Recipe not found');

    const deleted = await db
        .delete(recipeSampleImages)
        .where(
            and(
                eq(recipeSampleImages.recipeId, parsedRecipeId),
                eq(recipeSampleImages.imageId, parsedImageId),
                inArray(recipeSampleImages.authorId, uploaderAuthorIds)
            )
        )
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
