import { unstable_cache } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { authors, images, recipeColorSettings, recipeComparisonImages, recipeMonoSettings, recipeSampleImages, recipes } from '../db/schema.ts';
import { getRecipeSelectFields, normalizeRecipeRow } from './recipe-data.js';
import { hydrateRecipeImageRecord } from './recipe-image-assets.js';
import { getCommentsForRecipe } from './comments.js';
import { recipeDetailTag } from './public-recipe-catalog-cache.js';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS } from './public-recipe-catalog-constants.js';

async function fetchRecipeDetail(recipeId) {
    const selectFields = getRecipeSelectFields({ includeAuthorId: true, includeAuthorSocial: true, authorTable: authors });

    const rows = await db
        .select(selectFields)
        .from(recipes)
        .leftJoin(authors, eq(authors.id, recipes.authorId))
        .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
        .where(eq(recipes.id, recipeId))
        .limit(1);

    if (rows.length === 0) return null;
    const base = normalizeRecipeRow(rows[0]);

    const [comparisonRows, sampleRows, comments] = await Promise.all([
        db
            .select({
                label: recipeComparisonImages.label,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso }
            })
            .from(recipeComparisonImages)
            .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
            .where(and(eq(recipeComparisonImages.recipeId, recipeId), eq(images.copyright, true))),
        db
            .select({
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso, validExif: images.validExif },
                isPrimary: recipeSampleImages.isPrimary,
                author: { id: authors.id, uuid: authors.uuid, name: authors.name, instagramLink: authors.instagramLink, flickrLink: authors.flickrLink, website: authors.website, kofiLink: authors.kofiLink }
            })
            .from(recipeSampleImages)
            .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
            .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(eq(recipeSampleImages.recipeId, recipeId), eq(images.copyright, true)))
            .orderBy(asc(recipeSampleImages.imageId)),
        getCommentsForRecipe(recipeId)
    ]);

    const comparisonImages = comparisonRows
        .map((r) => (r.image?.id && r.image.copyright !== false ? { ...hydrateRecipeImageRecord(r.image), label: r.label } : null))
        .filter(Boolean);
    const sampleImages = sampleRows
        .map((r) => {
            if (!r?.image?.id || r.image.copyright === false) return null;
            return { ...hydrateRecipeImageRecord(r.image), isPrimary: r.isPrimary, sampleAuthor: r.author ?? null };
        })
        .filter(Boolean);

    return { ...base, comparisonImages, sampleImages, comments };
}

export function getCachedRecipeDetail(recipeId) {
    return unstable_cache(
        () => fetchRecipeDetail(recipeId),
        ['recipe-detail', String(recipeId)],
        { tags: [recipeDetailTag(recipeId)], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
    )();
}
