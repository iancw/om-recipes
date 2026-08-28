import { db } from '../../../db/index.ts';
import { recipeColorSettings, recipeMonoSettings, recipeSlugAliases, recipes } from '../../../db/schema.ts';
import { eq, or } from 'drizzle-orm';

import { makeOESXml } from '../../../lib/oes.js';
import { getRecipeSelectFields, normalizeRecipeRow } from '../../../lib/recipe-data.js';
import { isUuidLike } from '../../../lib/recipe-url.js';

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function stripOesExt(slugParam) {
    const s = String(slugParam ?? '');
    return s.toLowerCase().endsWith('.oes') ? s.slice(0, -4) : s;
}

export async function GET(_request, { params }) {
    // When accessing /oes/<slug>.oes, this route is /oes/[slug] and the suffix is left in the pathname.
    // Example: pathname "/oes/foo.oes" => params.slug === "foo.oes" (in prod)
    // Turbopack dev can be quirky here, so we fall back to parsing the pathname.
    const resolvedParams = await params;

    if (isBlank(resolvedParams?.slug)) {
        return new Response('Bad Request: missing slug', { status: 400 });
    }

    const slug = stripOesExt(resolvedParams.slug);

    const isUuid = isUuidLike(slug);

    let rows = await db
        .select(getRecipeSelectFields())
        .from(recipes)
        .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
        .where(isUuid ? or(eq(recipes.slug, slug), eq(recipes.uuid, slug)) : eq(recipes.slug, slug))
        .limit(1);

    if (rows.length === 0) {
        const aliasRows = await db
            .select({ recipeId: recipeSlugAliases.recipeId })
            .from(recipeSlugAliases)
            .where(eq(recipeSlugAliases.slug, slug))
            .limit(1);
        if (aliasRows.length > 0) {
            rows = await db
                .select(getRecipeSelectFields())
                .from(recipes)
                .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
                .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
                .where(eq(recipes.id, aliasRows[0].recipeId))
                .limit(1);
        }
    }

    if (rows.length === 0) {
        return new Response('Not Found', { status: 404 });
    }

    const recipeSettings = normalizeRecipeRow(rows[0]);
    const canonicalSlug = recipeSettings.slug || slug;
    const xml = makeOESXml(recipeSettings);

    return new Response(xml, {
        status: 200,
        headers: {
            'content-type': 'application/xml; charset=utf-8',
            'content-disposition': `attachment; filename="${canonicalSlug}.oes"`,
            'cache-control': 'public, max-age=3600'
        }
    });
}
