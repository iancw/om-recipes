import { PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

export async function revalidatePublicRecipeCatalog() {
    try {
        const { revalidateTag } = await import('next/cache');
        revalidateTag(PUBLIC_RECIPE_CATALOG_CACHE_TAG, 'max');
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') throw error;
    }
}

export function recipeDetailTag(recipeId) {
    return `recipe-detail:${recipeId}`;
}

export async function revalidateRecipeDetail(recipeId) {
    try {
        const { revalidateTag } = await import('next/cache');
        revalidateTag(recipeDetailTag(recipeId), 'max');
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') throw error;
    }
}
