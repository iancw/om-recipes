import { db } from '../db/index.ts';
import { recipes } from '../db/schema.ts';
import { getRecipePath } from '../lib/recipe-url.js';
import { unstable_cache } from 'next/cache';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from '../lib/public-recipe-catalog-constants.js';
import { GUIDE_PAGES } from '../lib/guide-pages.js';

const BASE_URL = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');

// Static pages carry hand-tuned crawl hints. The catalog root (`/`) changes
// whenever a recipe lands; the informational pages rarely move.
const STATIC_PAGES = [
    { path: '/', changeFrequency: 'daily', priority: 1 },
    { path: '/about', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/how-to', changeFrequency: 'monthly', priority: 0.5 },
    ...GUIDE_PAGES.map((page) => ({ path: page.href, changeFrequency: 'monthly', priority: 0.5 }))
];

const getCachedRecipeSitemapRows = unstable_cache(
    async () => db.select({ slug: recipes.slug, updatedAt: recipes.updatedAt }).from(recipes),
    ['public-recipe-sitemap'],
    { tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
);

export default async function sitemap() {
    const rows = await getCachedRecipeSitemapRows();
    const buildDate = new Date();

    const recipeEntries = rows
        .map((row) => ({
            url: `${BASE_URL}${getRecipePath({ slug: row.slug })}`,
            lastModified: row.updatedAt ?? buildDate,
            changeFrequency: 'monthly',
            priority: 0.7
        }))
        .filter((entry) => entry.url !== `${BASE_URL}/recipes`);

    const staticEntries = STATIC_PAGES.map(({ path, changeFrequency, priority }) => ({
        url: `${BASE_URL}${path}`,
        lastModified: buildDate,
        changeFrequency,
        priority
    }));

    return [...staticEntries, ...recipeEntries];
}
