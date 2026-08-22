import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { recipes, savedRecipes } from '../db/schema.ts';
import { notifyRecipeSaved } from './notifications.js';

function normalizeRecipeIds(recipeIds) {
    return Array.from(
        new Set(
            (recipeIds ?? [])
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value))
        )
    );
}

export async function getSavedRecipeIdsForUser({ userId, recipeIds }) {
    const normalizedUserId = Number(userId);
    const normalizedRecipeIds = normalizeRecipeIds(recipeIds);

    if (!Number.isFinite(normalizedUserId) || normalizedRecipeIds.length === 0) {
        return new Set();
    }

    const rows = await db
        .select({ recipeId: savedRecipes.recipeId })
        .from(savedRecipes)
        .where(and(eq(savedRecipes.userId, normalizedUserId), inArray(savedRecipes.recipeId, normalizedRecipeIds)));

    return new Set(rows.map((row) => row.recipeId));
}

export async function recipeExists(recipeId) {
    const normalizedRecipeId = Number(recipeId);
    if (!Number.isFinite(normalizedRecipeId)) return false;

    const rows = await db
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.id, normalizedRecipeId))
        .limit(1);

    return rows.length > 0;
}

export async function getSaveCountForRecipe(recipeId) {
    const normalizedRecipeId = Number(recipeId);
    if (!Number.isFinite(normalizedRecipeId)) return 0;

    const rows = await db
        .select({ value: sql`count(*)`.mapWith(Number) })
        .from(savedRecipes)
        .where(eq(savedRecipes.recipeId, normalizedRecipeId));

    return rows[0]?.value ?? 0;
}

export async function toggleSavedRecipeForUser({ userId, recipeId }) {
    const normalizedUserId = Number(userId);
    const normalizedRecipeId = Number(recipeId);

    if (!Number.isFinite(normalizedUserId) || !Number.isFinite(normalizedRecipeId)) {
        throw new Error('Invalid save request');
    }

    const existing = await db
        .select({ recipeId: savedRecipes.recipeId })
        .from(savedRecipes)
        .where(and(eq(savedRecipes.userId, normalizedUserId), eq(savedRecipes.recipeId, normalizedRecipeId)))
        .limit(1);

    if (existing.length > 0) {
        await db
            .delete(savedRecipes)
            .where(and(eq(savedRecipes.userId, normalizedUserId), eq(savedRecipes.recipeId, normalizedRecipeId)));
        return { isSaved: false };
    }

    await db.insert(savedRecipes).values({
        userId: normalizedUserId,
        recipeId: normalizedRecipeId
    });

    await notifyRecipeSaved(normalizedRecipeId, normalizedUserId);

    return { isSaved: true };
}
