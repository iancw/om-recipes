import { db } from '../db/index.ts';
import { recipes } from '../db/schema.ts';
import { getRecipePath } from '../lib/recipe-url.js';

const BASE_URL = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');

const STATIC_PAGES = ['/', '/about', '/how-to'];

export default async function sitemap() {
    const rows = await db
        .select({ slug: recipes.slug })
        .from(recipes);

    const recipeEntries = rows.map((row) => ({
        url: `${BASE_URL}${getRecipePath({ slug: row.slug })}`
    }))
        .filter((entry) => entry.url !== `${BASE_URL}/recipes`);

    const staticEntries = STATIC_PAGES.map((path) => ({
        url: `${BASE_URL}${path}`
    }));

    return [...staticEntries, ...recipeEntries];
}
