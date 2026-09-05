import { getSession } from '../../../lib/auth.js';
import { getRecipeIndex } from '../../../lib/public-recipe-catalog.js';
import { getUserSavedState } from '../../../lib/user-state-cache.js';
import { normalizeRecipeTypeFilter, RECIPE_TYPE_FILTER_VALUES } from '../../../lib/recipe-data.js';
import { normalizeRecipeSort, RECIPE_SORT_VALUES } from '../../../lib/recipe-sort.js';

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

function matchesQuery(recipe, query) {
    if (!query) return true;
    const haystack = `${recipe.recipeName} ${recipe.authorName} ${recipe.description ?? ''}`.toLowerCase();
    return haystack.includes(query);
}

function sortRecipes(recipes, sortBy) {
    const sorted = [...recipes];
    // Matches lib/public-recipe-catalog.js's original SQL orderBy tiebreak chains exactly:
    // OLDEST/NEWEST/AUTHOR/RECIPE_NAME end with saveCount desc, then id asc; the
    // default (SAVES) order ends with saveCount desc, createdAt desc, then id desc —
    // a different final tiebreak, so it can't share the same helper as the other four.
    const bySaveCountThenIdAsc = (a, b) => (b.saveCount - a.saveCount) || (a.id - b.id);

    if (sortBy === RECIPE_SORT_VALUES.OLDEST) {
        sorted.sort((a, b) => (a.createdAtMs - b.createdAtMs) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.NEWEST) {
        sorted.sort((a, b) => (b.createdAtMs - a.createdAtMs) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.AUTHOR) {
        sorted.sort((a, b) => a.authorName.localeCompare(b.authorName) || a.recipeName.localeCompare(b.recipeName) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.RECIPE_NAME) {
        sorted.sort((a, b) => a.recipeName.localeCompare(b.recipeName) || a.authorName.localeCompare(b.authorName) || bySaveCountThenIdAsc(a, b));
    } else {
        sorted.sort((a, b) => (b.saveCount - a.saveCount) || (b.createdAtMs - a.createdAtMs) || (b.id - a.id));
    }
    return sorted;
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

    const index = await getRecipeIndex();

    let filtered = index.filter((recipe) => matchesQuery(recipe, input.query));
    if (input.recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) {
        filtered = filtered.filter((recipe) => recipe.type === input.recipeType);
    }
    if (onlyMine) {
        filtered = filtered.filter((recipe) => recipe.authorUserId === userId);
    }

    let savedRecipeIdSet = null;
    if (userId != null && session?.user?.uuid) {
        const savedState = await getUserSavedState(session.user.uuid, userId);
        savedRecipeIdSet = new Set(savedState.savedRecipeIds);
    }
    if (onlySaved) {
        filtered = filtered.filter((recipe) => savedRecipeIdSet?.has(recipe.id));
    }

    const sorted = sortRecipes(filtered, input.sortBy);
    const page = sorted.slice(input.offset, input.offset + input.limit);
    const hasMore = input.offset + input.limit < sorted.length;

    return Response.json({
        results: page.map(({ authorUserId, aliases, saveCount, authorId, createdAtMs, ...card }) => ({
            ...card,
            viewerIsLoggedIn: userId != null,
            isSaved: savedRecipeIdSet?.has(card.id) ?? false
        })),
        hasMore,
        nextOffset: input.offset + page.length
    });
}
