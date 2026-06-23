import { db } from '../../../db/index.ts';
import {
  authors,
  images,
  recipeColorSettings,
  recipeComparisonImages,
  recipeMonoSettings,
  recipeSampleImages,
  recipes,
  savedRecipes
} from '../../../db/schema.ts';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { getSession } from '../../../lib/auth.js';
import {
  getRecipeSelectFields,
  normalizeRecipeRow,
  normalizeRecipeTypeFilter,
  RECIPE_TYPE_FILTER_VALUES
} from '../../../lib/recipe-data.js';
import { hydrateRecipeImageRecord } from '../../../lib/recipe-image-assets.js';
import { normalizeRecipeSort, RECIPE_SORT_VALUES } from '../../../lib/recipe-sort.js';
import { getSavedRecipeIdsForUser } from '../../../lib/recipe-saves.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').toLowerCase();
  const recipeType = normalizeRecipeTypeFilter(searchParams.get('type'));
  const onlyMine = searchParams.get('onlyMine') === '1';
  const onlySaved = searchParams.get('onlySaved') === '1';
  const sortBy = normalizeRecipeSort(searchParams.get('sort'));
  const session = await getSession();
  const userId = session?.user?.id ?? null;

  // Paginate results so the homepage can load incrementally.
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 12), 1), 100);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0);
  const fetchLimit = limit + 1;

  if ((onlyMine || onlySaved) && userId == null) {
    return Response.json({
      results: [],
      hasMore: false,
      nextOffset: offset
    });
  }

  const filters = [];
  if (query) {
    filters.push(
      or(
        ilike(recipes.recipeName, `%${query}%`),
        ilike(recipes.authorName, `%${query}%`),
        ilike(recipes.description, `%${query}%`)
      )
    );
  }
  if (recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) {
    filters.push(eq(recipes.type, recipeType));
  }
  if (onlyMine) {
    filters.push(eq(authors.userId, userId));
  }
  if (onlySaved) {
    filters.push(
      sql`exists (
        select 1
        from saved_recipes as viewer_saved_recipes
        where viewer_saved_recipes.recipe_id = ${recipes.id}
          and viewer_saved_recipes.user_id = ${userId}
      )`
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;
  const saveCount = count(savedRecipes.recipeId);
  const orderBy =
    sortBy === RECIPE_SORT_VALUES.OLDEST
      ? [asc(recipes.createdAt), desc(saveCount), asc(recipes.id)]
      : sortBy === RECIPE_SORT_VALUES.NEWEST
        ? [desc(recipes.createdAt), desc(saveCount), desc(recipes.id)]
        : sortBy === RECIPE_SORT_VALUES.AUTHOR
          ? [asc(recipes.authorName), asc(recipes.recipeName), desc(saveCount), asc(recipes.id)]
          : sortBy === RECIPE_SORT_VALUES.RECIPE_NAME
            ? [asc(recipes.recipeName), asc(recipes.authorName), desc(saveCount), asc(recipes.id)]
        : [desc(saveCount), desc(recipes.createdAt), desc(recipes.id)];

  // Fetch the base recipe rows first, then attach image arrays.
  // This avoids a huge Cartesian product when joining multiple image join tables.
  //
  // Response shape (per recipe):
  // {
  //   ...recipeFields,
  //   comparisonImages: [{ id, smallUrl, fullSizeUrl, dimensions, camera, lens, label? }],
  //   sampleImages: [{ id, smallUrl, fullSizeUrl, dimensions, camera, lens }]
  // }
  const recipeFields = getRecipeSelectFields({
    includeCreatedAt: true,
    includeAuthorSocial: true,
    authorTable: authors
  });

  const baseRecipes = await db
    .select({
      ...recipeFields,
      saveCount
    })
    .from(recipes)
    .leftJoin(authors, eq(authors.id, recipes.authorId))
    .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
    .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
    .leftJoin(savedRecipes, eq(savedRecipes.recipeId, recipes.id))
    .where(where)
    .groupBy(recipes.id, authors.id, recipeColorSettings.id, recipeMonoSettings.id)
    .orderBy(...orderBy)
    .limit(fetchLimit)
    .offset(offset);

  const hasMore = baseRecipes.length > limit;
  const pageRecipes = hasMore ? baseRecipes.slice(0, limit) : baseRecipes;
  const recipeIds = pageRecipes.map((r) => r.id);

  if (recipeIds.length === 0) {
    return Response.json({
      results: [],
      hasMore: false,
      nextOffset: offset
    });
  }

  const savedRecipeIds = await getSavedRecipeIdsForUser({ userId, recipeIds });

  const [comparisonRows, sampleRows] = await Promise.all([
    db
      .select({
        recipeId: recipeComparisonImages.recipeId,
        label: recipeComparisonImages.label,
        image: {
          id: images.id,
          copyright: images.copyright,
          preparedObjectKey: images.preparedObjectKey,
          smallUrl: images.smallUrl,
          fullSizeUrl: images.fullSizeUrl,
          dimensions: images.dimensions,
          camera: images.camera,
          lens: images.lens
        }
      })
      .from(recipeComparisonImages)
      .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
      .where(and(inArray(recipeComparisonImages.recipeId, recipeIds), eq(images.copyright, true))),

    db
      .select({
        recipeId: recipeSampleImages.recipeId,
        image: {
          id: images.id,
          copyright: images.copyright,
          preparedObjectKey: images.preparedObjectKey,
          smallUrl: images.smallUrl,
          fullSizeUrl: images.fullSizeUrl,
          dimensions: images.dimensions,
          camera: images.camera,
          lens: images.lens,
          validExif: images.validExif
        },
        isPrimary: recipeSampleImages.isPrimary,
        author: {
          id: authors.id,
          uuid: authors.uuid,
          name: authors.name,
          instagramLink: authors.instagramLink,
          flickrLink: authors.flickrLink,
          website: authors.website,
          kofiLink: authors.kofiLink
        }
      })
      .from(recipeSampleImages)
      .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
      .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
      .where(and(inArray(recipeSampleImages.recipeId, recipeIds), eq(images.copyright, true)))
      .orderBy(
        asc(recipeSampleImages.recipeId),
        asc(recipeSampleImages.imageId)
      )
  ]);

  /**
   * Group join rows into a stable, de-duped list per recipe.
   * Drizzle returns `image: null` if the join doesn't resolve; we skip those.
   */
  function groupByRecipeId(rows, mapRow) {
    const grouped = new Map();
    for (const row of rows) {
      const recipeId = row.recipeId;
      const mapped = mapRow(row);
      if (!mapped) continue;

      let list = grouped.get(recipeId);
      if (!list) {
        list = [];
        grouped.set(recipeId, list);
      }

      // De-dupe by image id when possible.
      if (mapped?.id != null && list.some((x) => x?.id === mapped.id)) continue;
      list.push(mapped);
    }
    return grouped;
  }

  const comparisonByRecipeId = groupByRecipeId(comparisonRows, (row) => {
    if (!row.image?.id || row.image.copyright === false) return null;
    return { ...hydrateRecipeImageRecord(row.image), label: row.label };
  });

  const sampleImagesByRecipeId = groupByRecipeId(sampleRows, (row) => {
    if (!row.image?.id || row.image.copyright === false) return null;
    return {
      ...hydrateRecipeImageRecord(row.image),
      isPrimary: row.isPrimary,
      sampleAuthor: row.author ?? null
    };
  });

  const results = pageRecipes.map((r) => {
    const { saveCount, ...recipe } = r;
    const normalizedRecipe = normalizeRecipeRow(recipe);
    return {
      ...normalizedRecipe,
      viewerIsLoggedIn: userId != null,
      isSaved: savedRecipeIds.has(r.id),
      comparisonImages: comparisonByRecipeId.get(r.id) ?? [],
      sampleImages: sampleImagesByRecipeId.get(r.id) ?? []
    };
  });

  return Response.json({
    results,
    hasMore,
    nextOffset: offset + results.length
  });
}
