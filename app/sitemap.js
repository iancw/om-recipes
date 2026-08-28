import { db } from '../db/index.ts';
import { recipes } from '../db/schema.ts';
import { getRecipePath } from '../lib/recipe-url.js';
import { unstable_cache } from 'next/cache';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from '../lib/public-recipe-catalog-constants.js';
import { GUIDE_PAGES } from '../lib/guide-pages.js';

const BASE_URL = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');

const STATIC_PAGES = ['/', '/about', '/how-to', ...GUIDE_PAGES.map((page) => page.href)];

const getCachedRecipeSitemapRows = unstable_cache(
    async () => db.select({ slug: recipes.slug }).from(recipes),
    ['public-recipe-sitemap'],
    { tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
);

export default async function sitemap() {
    const rows = await getCachedRecipeSitemapRows();

    const recipeEntries = rows.map((row) => ({
        url: `${BASE_URL}${getRecipePath({ slug: row.slug })}`
    }))
        .filter((entry) => entry.url !== `${BASE_URL}/recipes`);

    const staticEntries = STATIC_PAGES.map((path) => ({
        url: `${BASE_URL}${path}`
    }));

    return [...staticEntries, ...recipeEntries];
}
