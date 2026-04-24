export const RECIPE_QUERY_PARAM = 'recipe';
export const LEGACY_RECIPE_QUERY_PARAMS = [RECIPE_QUERY_PARAM, 'id', 'uuid', 'slug'];

function normalizeIdentifier(value) {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
}

export function isUuidLike(value) {
    const normalized = normalizeIdentifier(value);
    if (!normalized) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
}

export function getCanonicalRecipeIdentifier(recipe) {
    if (!recipe) return null;
    return normalizeIdentifier(recipe.slug) ?? normalizeIdentifier(recipe.uuid);
}

export function getRecipeIdentifierAliases(recipe) {
    const aliases = [];
    const slug = normalizeIdentifier(recipe?.slug);
    const uuid = normalizeIdentifier(recipe?.uuid);

    if (slug) aliases.push(slug);
    if (uuid && uuid !== slug) aliases.push(uuid);

    return aliases;
}

export function recipeMatchesIdentifier(recipe, identifier) {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    if (!normalizedIdentifier) return false;

    return getRecipeIdentifierAliases(recipe).some((alias) => alias === normalizedIdentifier);
}

export function findRecipeIndexByIdentifier(recipes, identifier) {
    if (!Array.isArray(recipes) || recipes.length === 0) return -1;
    return recipes.findIndex((recipe) => recipeMatchesIdentifier(recipe, identifier));
}

export function getRecipePath(recipe) {
    const identifier =
        typeof recipe === 'string'
            ? normalizeIdentifier(recipe)
            : getCanonicalRecipeIdentifier(recipe);

    if (!identifier) return '/recipes';
    return `/recipes/${encodeURIComponent(identifier)}`;
}

export function clearRecipeSearchParams(searchParams) {
    const nextParams = new URLSearchParams(searchParams);
    for (const key of LEGACY_RECIPE_QUERY_PARAMS) {
        nextParams.delete(key);
    }
    return nextParams;
}

export function buildRecipeSearchParams(searchParams, recipe) {
    const nextParams = clearRecipeSearchParams(searchParams);
    const identifier = getCanonicalRecipeIdentifier(recipe);
    if (identifier) {
        nextParams.set(RECIPE_QUERY_PARAM, identifier);
    }
    return nextParams;
}

export function getRecipeSelectionFromSearchParams(searchParams) {
    const params = new URLSearchParams(searchParams);
    for (const key of LEGACY_RECIPE_QUERY_PARAMS) {
        const value = normalizeIdentifier(params.get(key));
        if (value) {
            return { key, value };
        }
    }
    return null;
}
