import { db } from '../../../db/index.ts';
import { recipeSlugAliases, recipes } from '../../../db/schema.ts';
import { eq, or } from 'drizzle-orm';

import { isUuidLike } from '../../../lib/recipe-url.js';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const identifier = String(searchParams.get('recipe') ?? '').trim();

    if (!identifier) {
        return Response.json({ error: 'missing_identifier' }, { status: 400 });
    }

    const isUuid = isUuidLike(identifier);
    const direct = await db
        .select({ slug: recipes.slug })
        .from(recipes)
        .where(isUuid ? or(eq(recipes.slug, identifier), eq(recipes.uuid, identifier)) : eq(recipes.slug, identifier))
        .limit(1);

    if (direct.length > 0) {
        return Response.json({ canonical: direct[0].slug });
    }

    const alias = await db
        .select({ slug: recipes.slug })
        .from(recipeSlugAliases)
        .innerJoin(recipes, eq(recipes.id, recipeSlugAliases.recipeId))
        .where(eq(recipeSlugAliases.slug, identifier))
        .limit(1);

    if (alias.length > 0) {
        return Response.json({ canonical: alias[0].slug });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
}
