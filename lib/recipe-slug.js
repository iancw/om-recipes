import { and, eq, ne } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { recipeSlugAliases, recipes } from '../db/schema.ts';

const MAX_SLUG_SUFFIX = 1000;

export function slugify(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

export function computeSlugBase({ authorName, recipeName }) {
    return `${slugify(authorName)}_${slugify(recipeName)}`;
}

async function slugTakenByOthers(candidate, recipeId) {
    const recipeWhere =
        recipeId == null
            ? eq(recipes.slug, candidate)
            : and(eq(recipes.slug, candidate), ne(recipes.id, recipeId));
    const aliasWhere =
        recipeId == null
            ? eq(recipeSlugAliases.slug, candidate)
            : and(eq(recipeSlugAliases.slug, candidate), ne(recipeSlugAliases.recipeId, recipeId));

    const recipeHit = await db.select({ id: recipes.id }).from(recipes).where(recipeWhere).limit(1);
    if (recipeHit.length > 0) return true;

    const aliasHit = await db
        .select({ id: recipeSlugAliases.id })
        .from(recipeSlugAliases)
        .where(aliasWhere)
        .limit(1);
    return aliasHit.length > 0;
}

export async function resolveUniqueSlug({ base, recipeId = null }) {
    for (let i = 1; i <= MAX_SLUG_SUFFIX; i++) {
        const candidate = i === 1 ? base : `${base}-${i}`;
        if (!(await slugTakenByOthers(candidate, recipeId))) return candidate;
    }
    throw new Error('Unable to generate a unique slug');
}

export async function applySlugChange({ recipeId, oldSlug, newSlug }) {
    if (!newSlug || newSlug === oldSlug) {
        return { changed: false, newSlug: oldSlug };
    }

    // 1. Keep the old slug resolvable via a permanent alias.
    await db
        .insert(recipeSlugAliases)
        .values({ recipeId, slug: oldSlug })
        .onConflictDoNothing({ target: recipeSlugAliases.slug });

    // 2. Move the canonical slug.
    await db
        .update(recipes)
        .set({ slug: newSlug, updatedAt: new Date() })
        .where(eq(recipes.id, recipeId));

    // 3. If this rename reverts to a slug we previously aliased for this recipe,
    //    that alias row is now redundant (it would redirect the slug to itself).
    await db
        .delete(recipeSlugAliases)
        .where(and(eq(recipeSlugAliases.slug, newSlug), eq(recipeSlugAliases.recipeId, recipeId)));

    return { changed: true, newSlug };
}
