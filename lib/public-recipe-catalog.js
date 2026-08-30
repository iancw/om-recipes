import { unstable_cache } from 'next/cache';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
    authors,
    images,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipes,
    savedRecipes
} from '../db/schema.ts';
import { getRecipeSelectFields, normalizeRecipeRow, RECIPE_TYPE_FILTER_VALUES } from './recipe-data.js';
import { hydrateRecipeImageRecord } from './recipe-image-assets.js';
import { RECIPE_SORT_VALUES } from './recipe-sort.js';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

export { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

function groupByRecipeId(rows, mapRow) {
    const grouped = new Map();
    for (const row of rows) {
        const mapped = mapRow(row);
        if (!mapped) continue;
        const recipeId = row.recipeId;
        const list = grouped.get(recipeId) ?? [];
        if (!list.some((item) => item?.id === mapped.id)) list.push(mapped);
        grouped.set(recipeId, list);
    }
    return grouped;
}

export async function fetchRecipeCatalog({ query, recipeType, sortBy, limit, offset, userId = null, onlyMine = false, onlySaved = false }) {
    const filters = [];
    if (query) filters.push(or(ilike(recipes.recipeName, `%${query}%`), ilike(recipes.authorName, `%${query}%`), ilike(recipes.description, `%${query}%`)));
    if (recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) filters.push(eq(recipes.type, recipeType));
    if (onlyMine) filters.push(eq(authors.userId, userId));
    if (onlySaved) {
        filters.push(sql`exists (select 1 from saved_recipes as viewer_saved_recipes where viewer_saved_recipes.recipe_id = ${recipes.id} and viewer_saved_recipes.user_id = ${userId})`);
    }

    const saveCount = count(savedRecipes.recipeId);
    const orderBy =
        sortBy === RECIPE_SORT_VALUES.OLDEST ? [asc(recipes.createdAt), desc(saveCount), asc(recipes.id)]
            : sortBy === RECIPE_SORT_VALUES.NEWEST ? [desc(recipes.createdAt), desc(saveCount), asc(recipes.id)]
                : sortBy === RECIPE_SORT_VALUES.AUTHOR ? [asc(recipes.authorName), asc(recipes.recipeName), desc(saveCount), asc(recipes.id)]
                    : sortBy === RECIPE_SORT_VALUES.RECIPE_NAME ? [asc(recipes.recipeName), asc(recipes.authorName), desc(saveCount), asc(recipes.id)]
                        : [desc(saveCount), desc(recipes.createdAt), desc(recipes.id)];
    const fetchLimit = limit + 1;
    const baseRecipes = await db.select({ ...getRecipeSelectFields({ includeCreatedAt: true, includeAuthorSocial: true, authorTable: authors }), saveCount })
        .from(recipes).leftJoin(authors, eq(authors.id, recipes.authorId)).leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id)).leftJoin(savedRecipes, eq(savedRecipes.recipeId, recipes.id))
        .where(filters.length ? and(...filters) : undefined).groupBy(recipes.id, authors.id, recipeColorSettings.id, recipeMonoSettings.id)
        .orderBy(...orderBy).limit(fetchLimit).offset(offset);
    const hasMore = baseRecipes.length > limit;
    const pageRecipes = hasMore ? baseRecipes.slice(0, limit) : baseRecipes;
    const recipeIds = pageRecipes.map((recipe) => recipe.id);
    if (!recipeIds.length) return { recipes: [], hasMore, nextOffset: offset };

    const [comparisonRows, sampleRows] = await Promise.all([
        db.select({ recipeId: recipeComparisonImages.recipeId, label: recipeComparisonImages.label, image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso } })
            .from(recipeComparisonImages).leftJoin(images, eq(images.id, recipeComparisonImages.imageId)).where(and(inArray(recipeComparisonImages.recipeId, recipeIds), eq(images.copyright, true))),
        db.select({ recipeId: recipeSampleImages.recipeId, image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso, validExif: images.validExif }, isPrimary: recipeSampleImages.isPrimary, author: { id: authors.id, uuid: authors.uuid, name: authors.name, instagramLink: authors.instagramLink, flickrLink: authors.flickrLink, website: authors.website, kofiLink: authors.kofiLink } })
            .from(recipeSampleImages).leftJoin(images, eq(images.id, recipeSampleImages.imageId)).leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(inArray(recipeSampleImages.recipeId, recipeIds), eq(images.copyright, true))).orderBy(asc(recipeSampleImages.recipeId), asc(recipeSampleImages.imageId))
    ]);
    const comparisonByRecipeId = groupByRecipeId(comparisonRows, (row) => !row.image?.id || row.image.copyright === false ? null : { ...hydrateRecipeImageRecord(row.image), label: row.label });
    const sampleByRecipeId = groupByRecipeId(sampleRows, (row) => !row.image?.id || row.image.copyright === false ? null : { ...hydrateRecipeImageRecord(row.image), isPrimary: row.isPrimary, sampleAuthor: row.author ?? null });
    return {
        recipes: pageRecipes.map(({ saveCount: _saveCount, ...recipe }) => ({ ...normalizeRecipeRow(recipe), comparisonImages: comparisonByRecipeId.get(recipe.id) ?? [], sampleImages: sampleByRecipeId.get(recipe.id) ?? [] })),
        hasMore,
        nextOffset: offset + pageRecipes.length
    };
}

const getCachedPublicRecipeCatalog = unstable_cache(
    async (input) => fetchRecipeCatalog(input),
    ['public-recipe-catalog'],
    { tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
);

export function getPublicRecipeCatalog(input) {
    return getCachedPublicRecipeCatalog(input);
}

const getCachedRecipeLinkIndex = unstable_cache(
    async () => {
        const rows = await db
            .select({
                slug: recipes.slug,
                recipeName: recipes.recipeName,
                authorName: recipes.authorName,
                type: recipes.type
            })
            .from(recipes)
            .orderBy(asc(recipes.recipeName), asc(recipes.authorName));
        return rows.filter((row) => row.slug);
    },
    ['public-recipe-link-index'],
    { tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
);

/**
 * Lightweight, cached list of every published recipe (slug + display names only)
 * for server-rendered internal linking, e.g. the crawlable index on the homepage.
 */
export function getRecipeLinkIndex() {
    return getCachedRecipeLinkIndex();
}
