import { getSession } from '../../../lib/auth.js';
import { getPublicRecipeCatalog, fetchRecipeCatalog } from '../../../lib/public-recipe-catalog.js';
import { normalizeRecipeTypeFilter, RECIPE_TYPE_FILTER_VALUES } from '../../../lib/recipe-data.js';
import { normalizeRecipeSort } from '../../../lib/recipe-sort.js';
import { getSavedRecipeIdsForUser } from '../../../lib/recipe-saves.js';

function normalizeCatalogInput(searchParams) {
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 12), 1), 100);
    return {
        query: (searchParams.get('q') || '').toLowerCase(),
        recipeType: normalizeRecipeTypeFilter(searchParams.get('type')),
        sortBy: normalizeRecipeSort(searchParams.get('sort')),
        limit,
        offset: Math.max(Number(searchParams.get('offset') ?? 0), 0)
    };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const input = normalizeCatalogInput(searchParams);
    const onlyMine = searchParams.get('onlyMine') === '1';
    const onlySaved = searchParams.get('onlySaved') === '1';
    const session = await getSession();
    const userId = session?.user?.id ?? null;

    if ((onlyMine || onlySaved) && userId == null) {
        return Response.json({ results: [], hasMore: false, nextOffset: input.offset });
    }

    const catalog = onlyMine || onlySaved
        ? await fetchRecipeCatalog({ ...input, userId, onlyMine, onlySaved })
        : await getPublicRecipeCatalog(input);
    const savedRecipeIds = await getSavedRecipeIdsForUser({
        userId,
        recipeIds: catalog.recipes.map((recipe) => recipe.id)
    });

    return Response.json({
        results: catalog.recipes.map((recipe) => ({
            ...recipe,
            viewerIsLoggedIn: userId != null,
            isSaved: savedRecipeIds.has(recipe.id)
        })),
        hasMore: catalog.hasMore,
        nextOffset: catalog.nextOffset
    });
}
