import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { savedRecipes } from '../db/schema.ts';

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

export async function getSaveCountForRecipe(recipeId) {
    const normalizedRecipeId = Number(recipeId);
    if (!Number.isFinite(normalizedRecipeId)) return 0;

    const rows = await db
        .select({ value: sql`count(*)`.mapWith(Number) })
        .from(savedRecipes)
        .where(eq(savedRecipes.recipeId, normalizedRecipeId));

    return rows[0]?.value ?? 0;
}

export async function getAllSavedRecipeIdsForUser(userId) {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId)) return new Set();

    const rows = await db
        .select({ recipeId: savedRecipes.recipeId })
        .from(savedRecipes)
        .where(eq(savedRecipes.userId, normalizedUserId));

    return new Set(rows.map((row) => row.recipeId));
}

export async function reconcileSavedRecipesForUser({ userId, desiredRecipeIds }) {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId)) return;

    const desired = new Set(normalizeRecipeIds(desiredRecipeIds));
    const current = await getAllSavedRecipeIdsForUser(normalizedUserId);

    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    if (toAdd.length > 0) {
        await db
            .insert(savedRecipes)
            .values(toAdd.map((recipeId) => ({ userId: normalizedUserId, recipeId })))
            .onConflictDoNothing();
    }

    if (toRemove.length > 0) {
        await db
            .delete(savedRecipes)
            .where(and(eq(savedRecipes.userId, normalizedUserId), inArray(savedRecipes.recipeId, toRemove)));
    }
}
