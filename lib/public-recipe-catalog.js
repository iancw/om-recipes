import { unstable_cache } from 'next/cache';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
    authors,
    images,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipeSlugAliases,
    recipes,
    savedRecipes
} from '../db/schema.ts';
import { getRecipeSelectFields, normalizeRecipeRow } from './recipe-data.js';
import { hydrateRecipeImageRecord } from './recipe-image-assets.js';
import { getEquivalentWhiteBalance } from './whiteBalanceEquivalence.js';
import { recipeMatchesIdentifier } from './recipe-url.js';
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

async function fetchRecipeIndex() {
    const saveCount = count(savedRecipes.recipeId);
    const [baseRows, aliasRows] = await Promise.all([
        db
            .select({
                ...getRecipeSelectFields({ includeAuthorId: true, includeAuthorSocial: true, authorTable: authors }),
                authorUserId: authors.userId,
                saveCount
            })
            .from(recipes)
            .leftJoin(authors, eq(authors.id, recipes.authorId))
            .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
            .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
            .leftJoin(savedRecipes, eq(savedRecipes.recipeId, recipes.id))
            .groupBy(recipes.id, authors.id, recipeColorSettings.id, recipeMonoSettings.id)
            .orderBy(asc(recipes.id)),
        db.select({ recipeId: recipeSlugAliases.recipeId, slug: recipeSlugAliases.slug }).from(recipeSlugAliases)
    ]);

    const recipeIds = baseRows.map((row) => row.id);
    const aliasesByRecipeId = new Map();
    for (const row of aliasRows) {
        const list = aliasesByRecipeId.get(row.recipeId) ?? [];
        list.push(row.slug);
        aliasesByRecipeId.set(row.recipeId, list);
    }

    if (recipeIds.length === 0) return [];

    const [comparisonRows, sampleRows] = await Promise.all([
        db
            .select({
                recipeId: recipeComparisonImages.recipeId,
                label: recipeComparisonImages.label,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso }
            })
            .from(recipeComparisonImages)
            .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
            .where(and(inArray(recipeComparisonImages.recipeId, recipeIds), eq(images.copyright, true))),
        db
            .select({
                recipeId: recipeSampleImages.recipeId,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso, validExif: images.validExif },
                isPrimary: recipeSampleImages.isPrimary,
                author: { id: authors.id, uuid: authors.uuid, name: authors.name, instagramLink: authors.instagramLink, flickrLink: authors.flickrLink, website: authors.website, kofiLink: authors.kofiLink }
            })
            .from(recipeSampleImages)
            .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
            .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(inArray(recipeSampleImages.recipeId, recipeIds), eq(images.copyright, true)))
            .orderBy(asc(recipeSampleImages.recipeId), asc(recipeSampleImages.imageId))
    ]);

    const comparisonByRecipeId = groupByRecipeId(comparisonRows, (row) =>
        !row.image?.id || row.image.copyright === false ? null : { ...hydrateRecipeImageRecord(row.image), label: row.label }
    );
    const sampleByRecipeId = groupByRecipeId(sampleRows, (row) =>
        !row.image?.id || row.image.copyright === false
            ? null
            : { ...hydrateRecipeImageRecord(row.image), isPrimary: row.isPrimary, sampleAuthor: row.author ?? null }
    );

    return baseRows.map((row) => ({
        ...normalizeRecipeRow(row),
        authorId: row.authorId,
        authorUserId: row.authorUserId,
        authorSocial: row.authorSocial,
        saveCount: row.saveCount,
        // Plain number, immune to unstable_cache's JSON round-trip on cache
        // hits (unlike `createdAt`, which comes back as an ISO string after
        // the first request and silently breaks date-arithmetic sorting).
        createdAtMs: new Date(row.createdAt).getTime(),
        aliases: aliasesByRecipeId.get(row.id) ?? [],
        comparisonImages: comparisonByRecipeId.get(row.id) ?? [],
        sampleImages: sampleByRecipeId.get(row.id) ?? []
    }));
}

const getCachedRecipeIndex = unstable_cache(fetchRecipeIndex, ['recipe-index'], {
    tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG],
    revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS
});

export function getRecipeIndex() {
    return getCachedRecipeIndex();
}

export async function resolveRecipeIndexEntry(idOrSlug) {
    const identifier = String(idOrSlug ?? '').trim();
    if (!identifier) return null;

    const index = await getRecipeIndex();
    return (
        index.find((entry) => recipeMatchesIdentifier(entry, identifier)) ??
        index.find((entry) => entry.aliases.includes(identifier)) ??
        null
    );
}

function recipeMatchesWhiteBalance(candidate, whiteBalance) {
    const candidateWb = getEquivalentWhiteBalance(candidate);
    if (!candidateWb || candidateWb.type !== whiteBalance.type) return false;
    if (candidateWb.amberOffset !== whiteBalance.amberOffset) return false;
    if (candidateWb.greenOffset !== whiteBalance.greenOffset) return false;

    if (whiteBalance.type === 'temperature') return candidateWb.temperature === whiteBalance.temperature;
    if (whiteBalance.type === 'auto') return true; // both resolved type 'auto' already means whiteBalance2 starts with 'auto'
    if (whiteBalance.type === 'preset') return candidateWb.label === whiteBalance.label;
    return false;
}

export async function findRelatedWhiteBalanceRecipes(recipeId, whiteBalance, recipeType = null) {
    if (whiteBalance?.key == null) return [];

    const index = await getRecipeIndex();
    return index
        .filter((entry) => entry.id !== recipeId)
        .filter((entry) => (recipeType ? entry.type === recipeType : true))
        .filter((entry) => recipeMatchesWhiteBalance(entry, whiteBalance))
        .sort((a, b) => a.recipeName.localeCompare(b.recipeName) || a.authorName.localeCompare(b.authorName))
        .slice(0, 8)
        .map(({ id, uuid, slug, recipeName, authorName }) => ({ id, uuid, slug, recipeName, authorName }));
}
