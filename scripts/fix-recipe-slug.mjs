import { neon } from '@netlify/neon';

import { computeSlugBase, slugify } from '../lib/recipe-slug.js';
import { isUuidLike } from '../lib/recipe-url.js';

function usage() {
    return [
        'Usage:',
        '  npm run db:fix:recipe-slug -- <recipeIdOrUuid> [newSlug]',
        '',
        'With no newSlug, the slug is recomputed from the recipe\'s current',
        'author name and recipe name. The previous slug is kept as an alias',
        'so its old URL 308-redirects to the new one.'
    ].join('\n');
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function slugIsTaken(sql, candidate, recipeId) {
    const inRecipes = await sql`
        select 1 from recipes where slug = ${candidate} and id <> ${recipeId} limit 1
    `;
    if (inRecipes.length > 0) return true;
    const inAliases = await sql`
        select 1 from recipe_slug_aliases where slug = ${candidate} and recipe_id <> ${recipeId} limit 1
    `;
    return inAliases.length > 0;
}

async function resolveUnique(sql, base, recipeId) {
    for (let i = 1; i <= 1000; i++) {
        const candidate = i === 1 ? base : `${base}-${i}`;
        if (!(await slugIsTaken(sql, candidate, recipeId))) return candidate;
    }
    throw new Error('Unable to generate a unique slug');
}

export async function fixRecipeSlug({ recipe, newSlug, sql }) {
    const oldSlug = recipe.slug;
    let target = newSlug ? slugify(newSlug) : null;
    if (!target) {
        const base = computeSlugBase({ authorName: recipe.author_name, recipeName: recipe.recipe_name });
        target = await resolveUnique(sql, base, recipe.id);
    } else if (target !== oldSlug && (await slugIsTaken(sql, target, recipe.id))) {
        throw new Error(
            `Slug "${target}" is already used by another recipe or is a historical alias.`
        );
    }

    if (target === oldSlug) {
        return { oldSlug, newSlug: oldSlug, aliasCreated: false };
    }

    await sql`
        insert into recipe_slug_aliases (recipe_id, slug)
        values (${recipe.id}, ${oldSlug})
        on conflict (slug) do nothing
    `;
    await sql`
        update recipes set slug = ${target}, updated_at = now() where id = ${recipe.id}
    `;
    await sql`
        delete from recipe_slug_aliases where slug = ${target} and recipe_id = ${recipe.id}
    `;

    return { oldSlug, newSlug: target, aliasCreated: true };
}

async function main() {
    const [ref, newSlug] = process.argv.slice(2);
    if (!ref) fail(usage());

    const sql = neon();
    const isUuid = isUuidLike(ref);
    const rows = isUuid
        ? await sql`select id, slug, author_name, recipe_name from recipes where uuid = ${ref} limit 1`
        : /^\d+$/.test(ref)
          ? await sql`select id, slug, author_name, recipe_name from recipes where id = ${Number(ref)} limit 1`
          : await sql`select id, slug, author_name, recipe_name from recipes where slug = ${ref} limit 1`;

    if (rows.length === 0) fail(`No recipe found for "${ref}"`);

    const result = await fixRecipeSlug({ recipe: rows[0], newSlug, sql });
    if (!result.aliasCreated) {
        console.log(`No change: slug is already "${result.newSlug}"`);
        return;
    }
    console.log(`Slug changed: "${result.oldSlug}" -> "${result.newSlug}"`);
    console.log(`Alias kept: "${result.oldSlug}" now 308-redirects to "${result.newSlug}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => fail(err.stack || String(err)));
}
