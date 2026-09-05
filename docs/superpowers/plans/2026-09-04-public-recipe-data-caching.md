# Public Recipe Data Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Postgres query that currently runs on every view of the recipe detail page and every scroll/sort/filter combination on the homepage grid, replacing both with a shared, tag-invalidated Next.js data cache — so an anonymous or logged-out visitor browsing recipes never wakes Neon once the cache is warm.

**Architecture:** Two new cache layers on top of `unstable_cache`/`revalidateTag` (the mechanism `lib/public-recipe-catalog-cache.js` already established for the catalog): (1) a single **recipe index** cache holding every recipe's card-rendering and lookup fields, read in memory for sorting/filtering/pagination/id-resolution instead of re-querying Postgres per request; (2) a **per-recipe detail** cache, tagged individually per recipe id, holding the "heavy" payload (full settings, comments, sample/comparison images) for the detail page. Every write site that already busts the catalog cache also busts the specific `recipe-detail:<id>` tag(s) it affects.

**Known limitation (by design, not a gap):** this plan does not eliminate `getAuthedAuthorIds()` on `app/recipes/[id]/page.jsx` — a live, session-scoped `authors` lookup that runs for every *logged-in* viewer to compute `isOwner`. That's per-viewer state, not shared recipe data, and belongs to the separate blob-cached-user-state plan (not yet written), which will fold it into that user's cache. This plan fully eliminates DB reads for anonymous/logged-out browsing, and reduces logged-in browsing to that one small per-viewer query.

**Tech Stack:** Next.js `unstable_cache`/`revalidateTag` (already in use), Drizzle ORM, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-blob-cached-user-state-design.md`, §9 ("Public recipe data caching") and its subsections 9a-9d. The per-user Blobs work in §§1-8 of that spec is a separate, not-yet-planned piece of work this plan does not implement.

## Global Constraints

- Every recipe write site that currently calls `revalidatePublicRecipeCatalog()` must also call the new `revalidateRecipeDetail(recipeId)` for every recipe id it affects — per spec §9c.
- `addCommentAction`/`deleteCommentAction` currently call **no** catalog revalidation at all (comments never affected catalog display before); this plan adds a **new** `revalidateRecipeDetail(recipeId)` call to both, since comments are now part of the cached detail payload.
- The recipe index (§9a) and detail cache (§9b) share the existing `PUBLIC_RECIPE_CATALOG_CACHE_SECONDS` (24h) fallback `revalidate` window from `lib/public-recipe-catalog-constants.js` — do not introduce a different TTL.
- Do not touch anything from spec §§1-8 (per-user Blobs state, saves, notifications) — out of scope for this plan.
- `getSaveCountForRecipe` (owner-only, `app/recipes/[id]/page.jsx:275`) stays a live, uncached query — explicitly out of scope (spec Non-goals).
- Run `npm test` (vitest) after every task; run `npm run lint` before the final commit of each task.

---

### Task 1: Recipe index cache (`lib/public-recipe-catalog.js`)

Replaces the file's current per-request `fetchRecipeCatalog`/`getPublicRecipeCatalog` machinery (only ever called from `app/recipes/search/route.js`, which Task 4 rewrites) with a single cached `getRecipeIndex()`, plus two in-memory helpers used by later tasks: `resolveRecipeIndexEntry(idOrSlug)` and `findRelatedWhiteBalanceRecipes(recipeId, whiteBalance, recipeType)`.

**Files:**
- Modify: `lib/public-recipe-catalog.js` (full rewrite of its body; keep the `export { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG }` re-export line)
- Test: `tests/public-recipe-catalog.test.js` (new)

**Interfaces:**
- Consumes: `getRecipeSelectFields`, `normalizeRecipeRow` (`lib/recipe-data.js`), `hydrateRecipeImageRecord` (`lib/recipe-image-assets.js`), `getEquivalentWhiteBalance` (`lib/whiteBalanceEquivalence.js`), `getRecipeIdentifierAliases`, `recipeMatchesIdentifier` (`lib/recipe-url.js`), `db` (`db/index.ts`), `recipes`, `authors`, `recipeColorSettings`, `recipeMonoSettings`, `savedRecipes`, `recipeSlugAliases`, `recipeComparisonImages`, `recipeSampleImages`, `images` (`db/schema.ts`).
- Produces (used by Tasks 2-4):
  - `getRecipeIndex(): Promise<RecipeIndexEntry[]>` — cached, no arguments.
  - `RecipeIndexEntry` shape: everything `normalizeRecipeRow` produces, plus `authorId`, `authorUserId`, `authorSocial`, `saveCount`, `aliases: string[]`, `comparisonImages`, `sampleImages`.
  - `resolveRecipeIndexEntry(idOrSlug: string): Promise<RecipeIndexEntry | null>`.
  - `findRelatedWhiteBalanceRecipes(recipeId: number, whiteBalance: object | null, recipeType: string | null): Promise<{id, uuid, slug, recipeName, authorName}[]>` — limit 8, sorted by `recipeName` then `authorName`.

- [ ] **Step 1: Write the failing test for `getRecipeIndex`**

Create `tests/public-recipe-catalog.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

vi.mock('next/cache', () => ({
    unstable_cache: (fn, keyParts = []) => async (...args) => {
        const key = JSON.stringify([keyParts, args]);
        if (!cacheState.entries.has(key)) cacheState.entries.set(key, fn(...args));
        return cacheState.entries.get(key);
    },
    revalidateTag: vi.fn()
}));

vi.mock('../db/index.ts', () => ({
    db: { select: (...args) => selectMock(...args) }
}));

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
}

const baseRecipeRow = {
    id: 101,
    uuid: 'recipe-uuid',
    slug: 'portra-400',
    type: 'COLOR',
    recipeName: 'Portra 400',
    authorName: 'Author',
    description: 'Description',
    sourceUrl: null,
    yellow: 0, orange: 0, orangeRed: 0, red: 0, magenta: 0, violet: 0,
    blue: 0, blueCyan: 0, cyan: 0, greenCyan: 0, green: 0, yellowGreen: 0,
    contrast: 0, sharpness: 0, highlights: 0, shadows: 0, midtones: 0,
    shadingEffect: 0, exposureCompensation: 0,
    whiteBalance2: null, whiteBalanceTemperature: null,
    whiteBalanceAmberOffset: 0, whiteBalanceGreenOffset: 0,
    createdAt: new Date('2026-04-30T00:00:00Z'),
    authorId: 9,
    authorUserId: 55,
    authorSocial: { instagram: null, flickr: null, website: null, kofi: null },
    colorSettings: {
        yellow: 0, orange: 0, orangeRed: 0, red: 0, magenta: 0, violet: 0,
        blue: 0, blueCyan: 0, cyan: 0, greenCyan: 0, green: 0, yellowGreen: 0,
        contrast: 0, sharpness: 0, highlights: 0, shadows: 0, midtones: 0,
        shadingEffect: 0, exposureCompensation: 0,
        whiteBalance2: null, whiteBalanceTemperature: null,
        whiteBalanceAmberOffset: 0, whiteBalanceGreenOffset: 0
    },
    monoSettings: null,
    saveCount: 3
};

function queueDefaultSelects() {
    selectMock = vi.fn(() => {
        const responses = [
            [baseRecipeRow], // recipes+settings+saveCount
            [{ recipeId: 101, slug: 'old-portra-slug' }], // recipeSlugAliases
            [], // comparisonImages
            [] // sampleImages
        ];
        let call = 0;
        selectMock.mockImplementation(() => makeSelectChain(responses[call++] ?? []));
        return makeSelectChain(responses[0]);
    });
}

describe('getRecipeIndex', () => {
    beforeEach(() => {
        vi.resetModules();
        cacheState.entries.clear();
        queueDefaultSelects();
    });

    it('returns a normalized, alias-annotated index and caches across calls', async () => {
        const { getRecipeIndex } = await import('../lib/public-recipe-catalog.js');

        const first = await getRecipeIndex();
        const second = await getRecipeIndex();

        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            id: 101,
            slug: 'portra-400',
            authorUserId: 55,
            saveCount: 3,
            aliases: ['old-portra-slug']
        });
        expect(second).toBe(first); // same cached array instance, no re-fetch
        expect(selectMock).toHaveBeenCalledTimes(4); // one fetch total, not one per call
    });
});

describe('resolveRecipeIndexEntry', () => {
    beforeEach(() => {
        vi.resetModules();
        cacheState.entries.clear();
        queueDefaultSelects();
    });

    it('resolves by canonical slug, uuid, and old alias slug', async () => {
        const { resolveRecipeIndexEntry } = await import('../lib/public-recipe-catalog.js');

        expect((await resolveRecipeIndexEntry('portra-400'))?.id).toBe(101);
        expect((await resolveRecipeIndexEntry('recipe-uuid'))?.id).toBe(101);
        expect((await resolveRecipeIndexEntry('old-portra-slug'))?.id).toBe(101);
        expect(await resolveRecipeIndexEntry('nope')).toBeNull();
    });
});

describe('findRelatedWhiteBalanceRecipes', () => {
    beforeEach(() => {
        vi.resetModules();
        cacheState.entries.clear();
        selectMock = vi.fn(() => {
            const responses = [
                [
                    { ...baseRecipeRow, id: 101, slug: 'a', recipeName: 'A', whiteBalanceTemperature: 5500 },
                    { ...baseRecipeRow, id: 102, slug: 'b', recipeName: 'B', whiteBalanceTemperature: 5500 },
                    { ...baseRecipeRow, id: 103, slug: 'c', recipeName: 'C', whiteBalanceTemperature: 4000 }
                ],
                [],
                [],
                []
            ];
            let call = 0;
            selectMock.mockImplementation(() => makeSelectChain(responses[call++] ?? []));
            return makeSelectChain(responses[0]);
        });
    });

    it('matches on temperature + offsets, excludes self, sorts by name, caps at 8', async () => {
        const { findRelatedWhiteBalanceRecipes } = await import('../lib/public-recipe-catalog.js');
        const { getEquivalentWhiteBalance } = await import('../lib/whiteBalanceEquivalence.js');

        const whiteBalance = getEquivalentWhiteBalance({
            whiteBalanceTemperature: 5500,
            whiteBalanceAmberOffset: 0,
            whiteBalanceGreenOffset: 0
        });

        const related = await findRelatedWhiteBalanceRecipes(101, whiteBalance, 'COLOR');

        expect(related).toEqual([{ id: 102, uuid: 'recipe-uuid', slug: 'b', recipeName: 'B', authorName: 'Author' }]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/public-recipe-catalog.test.js`
Expected: FAIL — `getRecipeIndex`/`resolveRecipeIndexEntry`/`findRelatedWhiteBalanceRecipes` are not exported yet.

- [ ] **Step 3: Rewrite `lib/public-recipe-catalog.js`**

```js
import { unstable_cache } from 'next/cache';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
    authors,
    images,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipeSlugAliases,
    recipes,
    savedRecipes
} from '../db/schema.ts';
import { getRecipeSelectFields, normalizeRecipeRow } from './recipe-data.js';
import { hydrateRecipeImageRecord } from './recipe-image-assets.js';
import { getEquivalentWhiteBalance } from './whiteBalanceEquivalence.js';
import { recipeMatchesIdentifier } from './recipe-url.js';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

export { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS, PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

function groupByRecipeId(rows, mapRow) {
    const grouped = new Map();
    for (const row of rows) {
        const mapped = mapRow(row);
        if (!mapped) continue;
        const recipeId = row.recipeId;
        const list = grouped.get(recipeId) ?? [];
        if (!list.some((item) => item?.id === mapped.id)) list.push(mapped);
        grouped.set(recipeId, list);
    }
    return grouped;
}

async function fetchRecipeIndex() {
    const saveCount = count(savedRecipes.recipeId);
    const [baseRows, aliasRows] = await Promise.all([
        db
            .select({
                ...getRecipeSelectFields({ includeAuthorId: true, includeAuthorSocial: true, authorTable: authors }),
                authorUserId: authors.userId,
                saveCount
            })
            .from(recipes)
            .leftJoin(authors, eq(authors.id, recipes.authorId))
            .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
            .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
            .leftJoin(savedRecipes, eq(savedRecipes.recipeId, recipes.id))
            .groupBy(recipes.id, authors.id, recipeColorSettings.id, recipeMonoSettings.id)
            .orderBy(asc(recipes.id)),
        db.select({ recipeId: recipeSlugAliases.recipeId, slug: recipeSlugAliases.slug }).from(recipeSlugAliases)
    ]);

    const recipeIds = baseRows.map((row) => row.id);
    const aliasesByRecipeId = new Map();
    for (const row of aliasRows) {
        const list = aliasesByRecipeId.get(row.recipeId) ?? [];
        list.push(row.slug);
        aliasesByRecipeId.set(row.recipeId, list);
    }

    if (recipeIds.length === 0) return [];

    const [comparisonRows, sampleRows] = await Promise.all([
        db
            .select({
                recipeId: recipeComparisonImages.recipeId,
                label: recipeComparisonImages.label,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso }
            })
            .from(recipeComparisonImages)
            .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
            .where(and(inArray(recipeComparisonImages.recipeId, recipeIds), eq(images.copyright, true))),
        db
            .select({
                recipeId: recipeSampleImages.recipeId,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso, validExif: images.validExif },
                isPrimary: recipeSampleImages.isPrimary,
                author: { id: authors.id, uuid: authors.uuid, name: authors.name, instagramLink: authors.instagramLink, flickrLink: authors.flickrLink, website: authors.website, kofiLink: authors.kofiLink }
            })
            .from(recipeSampleImages)
            .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
            .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(inArray(recipeSampleImages.recipeId, recipeIds), eq(images.copyright, true)))
            .orderBy(asc(recipeSampleImages.recipeId), asc(recipeSampleImages.imageId))
    ]);

    const comparisonByRecipeId = groupByRecipeId(comparisonRows, (row) =>
        !row.image?.id || row.image.copyright === false ? null : { ...hydrateRecipeImageRecord(row.image), label: row.label }
    );
    const sampleByRecipeId = groupByRecipeId(sampleRows, (row) =>
        !row.image?.id || row.image.copyright === false
            ? null
            : { ...hydrateRecipeImageRecord(row.image), isPrimary: row.isPrimary, sampleAuthor: row.author ?? null }
    );

    return baseRows.map((row) => ({
        ...normalizeRecipeRow(row),
        authorId: row.authorId,
        authorUserId: row.authorUserId,
        authorSocial: row.authorSocial,
        saveCount: row.saveCount,
        aliases: aliasesByRecipeId.get(row.id) ?? [],
        comparisonImages: comparisonByRecipeId.get(row.id) ?? [],
        sampleImages: sampleByRecipeId.get(row.id) ?? []
    }));
}

const getCachedRecipeIndex = unstable_cache(fetchRecipeIndex, ['recipe-index'], {
    tags: [PUBLIC_RECIPE_CATALOG_CACHE_TAG],
    revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS
});

export function getRecipeIndex() {
    return getCachedRecipeIndex();
}

export async function resolveRecipeIndexEntry(idOrSlug) {
    const identifier = String(idOrSlug ?? '').trim();
    if (!identifier) return null;

    const index = await getRecipeIndex();
    return (
        index.find((entry) => recipeMatchesIdentifier(entry, identifier)) ??
        index.find((entry) => entry.aliases.includes(identifier)) ??
        null
    );
}

function recipeMatchesWhiteBalance(candidate, whiteBalance) {
    const candidateWb = getEquivalentWhiteBalance(candidate);
    if (!candidateWb || candidateWb.type !== whiteBalance.type) return false;
    if (candidateWb.amberOffset !== whiteBalance.amberOffset) return false;
    if (candidateWb.greenOffset !== whiteBalance.greenOffset) return false;

    if (whiteBalance.type === 'temperature') return candidateWb.temperature === whiteBalance.temperature;
    if (whiteBalance.type === 'auto') return true; // both resolved type 'auto' already means whiteBalance2 starts with 'auto'
    if (whiteBalance.type === 'preset') return candidateWb.label === whiteBalance.label;
    return false;
}

export async function findRelatedWhiteBalanceRecipes(recipeId, whiteBalance, recipeType = null) {
    if (whiteBalance?.key == null) return [];

    const index = await getRecipeIndex();
    return index
        .filter((entry) => entry.id !== recipeId)
        .filter((entry) => (recipeType ? entry.type === recipeType : true))
        .filter((entry) => recipeMatchesWhiteBalance(entry, whiteBalance))
        .sort((a, b) => a.recipeName.localeCompare(b.recipeName) || a.authorName.localeCompare(b.authorName))
        .slice(0, 8)
        .map(({ id, uuid, slug, recipeName, authorName }) => ({ id, uuid, slug, recipeName, authorName }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/public-recipe-catalog.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/public-recipe-catalog.js tests/public-recipe-catalog.test.js
git commit -m "Replace per-request recipe catalog queries with a cached recipe index"
```

---

### Task 2: Per-recipe detail cache (`lib/recipe-detail-cache.js`, `lib/public-recipe-catalog-cache.js`)

**Files:**
- Modify: `lib/public-recipe-catalog-cache.js`
- Create: `lib/recipe-detail-cache.js`
- Test: `tests/recipe-detail-cache.test.js` (new)
- Test: `tests/public-recipe-catalog-cache.test.js` (new, if one doesn't already exist — check first)

**Interfaces:**
- Consumes: `getRecipeSelectFields`, `normalizeRecipeRow` (`lib/recipe-data.js`), `hydrateRecipeImageRecord` (`lib/recipe-image-assets.js`), `getCommentsForRecipe` (`lib/comments.js`), `db`/schema tables (as in Task 1).
- Produces (used by Task 3):
  - `recipeDetailTag(recipeId: number): string` — `` `recipe-detail:${recipeId}` ``.
  - `revalidateRecipeDetail(recipeId: number): Promise<void>` (`lib/public-recipe-catalog-cache.js`).
  - `getCachedRecipeDetail(recipeId: number): Promise<RecipeDetail | null>` (`lib/recipe-detail-cache.js`) — `RecipeDetail` is `{ authorId, colorSettings, monoSettings, ...normalizedRecipeFields, comparisonImages, sampleImages, comments }` (no `slug`/`aliases`/`isSaved`/`viewerIsLoggedIn` — those come from the index/session in Task 3).

- [ ] **Step 1: Check for an existing catalog-cache test file**

Run: `ls tests/ | grep -i public-recipe-catalog-cache`
If a file exists, read it before writing Step 2's test so you extend rather than duplicate it.

- [ ] **Step 2: Write the failing tests**

Create/extend `tests/public-recipe-catalog-cache.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';

const revalidateTagMock = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...args) => revalidateTagMock(...args) }));

describe('recipeDetailTag / revalidateRecipeDetail', () => {
    it('builds a stable per-recipe tag string', async () => {
        const { recipeDetailTag } = await import('../lib/public-recipe-catalog-cache.js');
        expect(recipeDetailTag(123)).toBe('recipe-detail:123');
    });

    it('revalidates only that recipe\'s tag', async () => {
        const { revalidateRecipeDetail } = await import('../lib/public-recipe-catalog-cache.js');
        await revalidateRecipeDetail(123);
        expect(revalidateTagMock).toHaveBeenCalledWith('recipe-detail:123', 'max');
    });
});
```

Create `tests/recipe-detail-cache.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getCommentsForRecipeMock;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

vi.mock('next/cache', () => ({
    unstable_cache: (fn, keyParts = []) => async (...args) => {
        const key = JSON.stringify([keyParts, args]);
        if (!cacheState.entries.has(key)) cacheState.entries.set(key, fn(...args));
        return cacheState.entries.get(key);
    },
    revalidateTag: vi.fn()
}));

vi.mock('../db/index.ts', () => ({ db: { select: (...args) => selectMock(...args) } }));

vi.mock('../lib/comments.js', () => ({
    getCommentsForRecipe: (...args) => getCommentsForRecipeMock(...args)
}));

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn(() => Promise.resolve(result)),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
}

describe('getCachedRecipeDetail', () => {
    beforeEach(() => {
        vi.resetModules();
        cacheState.entries.clear();
        getCommentsForRecipeMock = vi.fn(async () => [{ id: 1, body: 'Nice!' }]);

        const responses = [
            [{
                id: 123, uuid: 'recipe-uuid', slug: 'portra-400', type: 'COLOR',
                recipeName: 'Portra 400', authorName: 'Author', description: 'Description', sourceUrl: null,
                yellow: 0, orange: 0, orangeRed: 0, red: 0, magenta: 0, violet: 0, blue: 0, blueCyan: 0,
                cyan: 0, greenCyan: 0, green: 0, yellowGreen: 0, contrast: 0, sharpness: 0, highlights: 0,
                shadows: 0, midtones: 0, shadingEffect: 0, exposureCompensation: 0, whiteBalance2: null,
                whiteBalanceTemperature: null, whiteBalanceAmberOffset: 0, whiteBalanceGreenOffset: 0,
                authorId: 9,
                authorSocial: { instagram: null, flickr: null, website: null, kofi: null },
                colorSettings: { yellow: 0, orange: 0, orangeRed: 0, red: 0, magenta: 0, violet: 0, blue: 0, blueCyan: 0, cyan: 0, greenCyan: 0, green: 0, yellowGreen: 0, contrast: 0, sharpness: 0, highlights: 0, shadows: 0, midtones: 0, shadingEffect: 0, exposureCompensation: 0, whiteBalance2: null, whiteBalanceTemperature: null, whiteBalanceAmberOffset: 0, whiteBalanceGreenOffset: 0 },
                monoSettings: null
            }],
            [], // comparisonImages
            []  // sampleImages
        ];
        let call = 0;
        selectMock = vi.fn(() => makeSelectChain(responses[call++] ?? []));
    });

    it('fetches once per recipe id and includes comments', async () => {
        const { getCachedRecipeDetail } = await import('../lib/recipe-detail-cache.js');

        const first = await getCachedRecipeDetail(123);
        const second = await getCachedRecipeDetail(123);

        expect(first.recipeName).toBe('Portra 400');
        expect(first.comments).toEqual([{ id: 1, body: 'Nice!' }]);
        expect(second).toBe(first);
        expect(selectMock).toHaveBeenCalledTimes(3); // one fetch, not two
        expect(getCommentsForRecipeMock).toHaveBeenCalledTimes(1);
    });

    it('returns null when the recipe row is missing', async () => {
        selectMock = vi.fn(() => makeSelectChain([]));
        const { getCachedRecipeDetail } = await import('../lib/recipe-detail-cache.js');

        expect(await getCachedRecipeDetail(999)).toBeNull();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/public-recipe-catalog-cache.test.js tests/recipe-detail-cache.test.js`
Expected: FAIL — `recipeDetailTag`/`revalidateRecipeDetail` and `lib/recipe-detail-cache.js` don't exist yet.

- [ ] **Step 4: Add `recipeDetailTag`/`revalidateRecipeDetail` to `lib/public-recipe-catalog-cache.js`**

Read the current file first (`lib/public-recipe-catalog-cache.js`, 10 lines) — it's:

```js
import { PUBLIC_RECIPE_CATALOG_CACHE_TAG } from './public-recipe-catalog-constants.js';

export async function revalidatePublicRecipeCatalog() {
    try {
        const { revalidateTag } = await import('next/cache');
        revalidateTag(PUBLIC_RECIPE_CATALOG_CACHE_TAG, 'max');
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') throw error;
    }
}
```

Replace it with:

```js
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
```

- [ ] **Step 5: Create `lib/recipe-detail-cache.js`**

```js
import { unstable_cache } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { authors, images, recipeColorSettings, recipeComparisonImages, recipeMonoSettings, recipeSampleImages, recipes } from '../db/schema.ts';
import { getRecipeSelectFields, normalizeRecipeRow } from './recipe-data.js';
import { hydrateRecipeImageRecord } from './recipe-image-assets.js';
import { getCommentsForRecipe } from './comments.js';
import { recipeDetailTag } from './public-recipe-catalog-cache.js';
import { PUBLIC_RECIPE_CATALOG_CACHE_SECONDS } from './public-recipe-catalog-constants.js';

async function fetchRecipeDetail(recipeId) {
    const selectFields = getRecipeSelectFields({ includeAuthorId: true, includeAuthorSocial: true, authorTable: authors });

    const rows = await db
        .select(selectFields)
        .from(recipes)
        .leftJoin(authors, eq(authors.id, recipes.authorId))
        .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
        .where(eq(recipes.id, recipeId))
        .limit(1);

    if (rows.length === 0) return null;
    const base = normalizeRecipeRow(rows[0]);

    const [comparisonRows, sampleRows, comments] = await Promise.all([
        db
            .select({
                label: recipeComparisonImages.label,
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso }
            })
            .from(recipeComparisonImages)
            .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
            .where(and(eq(recipeComparisonImages.recipeId, recipeId), eq(images.copyright, true))),
        db
            .select({
                image: { id: images.id, uuid: images.uuid, copyright: images.copyright, preparedObjectKey: images.preparedObjectKey, smallUrl: images.smallUrl, fullSizeUrl: images.fullSizeUrl, dimensions: images.dimensions, camera: images.camera, lens: images.lens, shutterSpeed: images.shutterSpeed, aperture: images.aperture, focalLength: images.focalLength, iso: images.iso, validExif: images.validExif },
                isPrimary: recipeSampleImages.isPrimary,
                author: { id: authors.id, uuid: authors.uuid, name: authors.name, instagramLink: authors.instagramLink, flickrLink: authors.flickrLink, website: authors.website, kofiLink: authors.kofiLink }
            })
            .from(recipeSampleImages)
            .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
            .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(eq(recipeSampleImages.recipeId, recipeId), eq(images.copyright, true)))
            .orderBy(asc(recipeSampleImages.imageId)),
        getCommentsForRecipe(recipeId)
    ]);

    const comparisonImages = comparisonRows
        .map((r) => (r.image?.id && r.image.copyright !== false ? { ...hydrateRecipeImageRecord(r.image), label: r.label } : null))
        .filter(Boolean);
    const sampleImages = sampleRows
        .map((r) => {
            if (!r?.image?.id || r.image.copyright === false) return null;
            return { ...hydrateRecipeImageRecord(r.image), isPrimary: r.isPrimary, sampleAuthor: r.author ?? null };
        })
        .filter(Boolean);

    return { ...base, comparisonImages, sampleImages, comments };
}

export function getCachedRecipeDetail(recipeId) {
    return unstable_cache(
        () => fetchRecipeDetail(recipeId),
        ['recipe-detail', String(recipeId)],
        { tags: [recipeDetailTag(recipeId)], revalidate: PUBLIC_RECIPE_CATALOG_CACHE_SECONDS }
    )();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/public-recipe-catalog-cache.test.js tests/recipe-detail-cache.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/public-recipe-catalog-cache.js lib/recipe-detail-cache.js tests/public-recipe-catalog-cache.test.js tests/recipe-detail-cache.test.js
git commit -m "Add per-recipe detail cache with a dedicated invalidation tag"
```

---

### Task 3: Rewire the recipe detail page onto the cache

**Files:**
- Modify: `app/recipes/[id]/page.jsx`
- Test: `tests/recipe-detail-page.test.js`

**Interfaces:**
- Consumes: `resolveRecipeIndexEntry`, `findRelatedWhiteBalanceRecipes` (`lib/public-recipe-catalog.js`, Task 1), `getCachedRecipeDetail` (`lib/recipe-detail-cache.js`, Task 2).
- Produces: unchanged page-level behavior/props for `RecipeCard`, `SampleGallery`, `CommentsSection` (this task changes the data *source*, not the rendered shape) — `recipe.isSaved` stays hardcoded `false` here (owned by the separate blob-cached-user-state plan, not this one).

- [ ] **Step 1: Update the failing test first**

`tests/recipe-detail-page.test.js` currently mocks raw `db.select` chains and `../lib/comments.js`. Replace that with mocks of the two new cache functions, since the page no longer queries the DB directly. Replace the file's mocks and fixture data (keep everything below `describe('recipe detail page redirects'...` and its four `it()` blocks that don't touch data-fetching, but update the fixtures):

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let getSessionMock;
let permanentRedirectMock;
let notFoundMock;
let resolveRecipeIndexEntryMock;
let findRelatedWhiteBalanceRecipesMock;
let getCachedRecipeDetailMock;
let capturedRecipeCardProps;

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    resolveRecipeIndexEntry: (...args) => resolveRecipeIndexEntryMock(...args),
    findRelatedWhiteBalanceRecipes: (...args) => findRelatedWhiteBalanceRecipesMock(...args)
}));

vi.mock('../lib/recipe-detail-cache.js', () => ({
    getCachedRecipeDetail: (...args) => getCachedRecipeDetailMock(...args)
}));

vi.mock('../db/index.ts', () => ({
    db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } // only getAuthedAuthorIds uses this now
}));

vi.mock('next/navigation', () => ({
    notFound: (...args) => notFoundMock(...args),
    permanentRedirect: (...args) => permanentRedirectMock(...args)
}));

vi.mock('../components/recipe-card.jsx', () => ({
    default: (props) => {
        capturedRecipeCardProps = props;
        return null;
    }
}));

vi.mock('../components/SampleGallery.jsx', () => ({ default: () => null }));
vi.mock('../components/CommentsSection.jsx', () => ({ default: () => null }));
vi.mock('../components/ui/badge.jsx', () => ({ Badge: () => null }));
vi.mock('../components/ui/card.jsx', () => ({
    Card: ({ children }) => children ?? null,
    CardContent: ({ children }) => children ?? null
}));

vi.mock('../app/recipes/[id]/actions.js', () => ({
    addCommentAction: vi.fn(),
    deleteCommentAction: vi.fn(),
    deleteMyRecipeAction: vi.fn(),
    deleteRecipeSampleImageAction: vi.fn(),
    setPrimaryRecipeSampleImageAction: vi.fn(),
    updateRecipeAction: vi.fn()
}));

const baseDetail = {
    id: 123,
    uuid: '123e4567-e89b-12d3-a456-426614174000',
    slug: 'portra-400',
    type: 'COLOR',
    recipeName: 'Portra 400',
    authorName: 'Author',
    description: 'Description',
    authorId: 9,
    whiteBalance2: null,
    whiteBalanceTemperature: null,
    whiteBalanceAmberOffset: 0,
    whiteBalanceGreenOffset: 0,
    comparisonImages: [
        { id: 201, preparedObjectKey: 'authors/a/recipes/r/comparison.jpg', assetUrls: { original: 'https://images.om-recipes.com/authors/a/recipes/r/comparison.jpg' }, label: 'Before' }
    ],
    sampleImages: [
        { id: 301, preparedObjectKey: 'authors/a/recipes/r/sample.jpg', assetUrls: { original: 'https://images.om-recipes.com/authors/a/recipes/r/sample.jpg' }, isPrimary: true }
    ],
    comments: []
};

describe('recipe detail page redirects', () => {
    beforeEach(() => {
        vi.resetModules();
        globalThis.React = {
            createElement: vi.fn((type, props, ...children) => {
                const resolvedProps = {
                    ...(props ?? {}),
                    ...(children.length > 0 ? { children: children.length === 1 ? children[0] : children } : {})
                };
                if (typeof type === 'function') return type(resolvedProps);
                return { type, props: resolvedProps };
            })
        };

        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
        permanentRedirectMock = vi.fn((location) => { throw new Error(`REDIRECT:${location}`); });
        capturedRecipeCardProps = null;

        resolveRecipeIndexEntryMock = vi.fn(async (id) =>
            id === '123e4567-e89b-12d3-a456-426614174000' || id === 'portra-400' || id === 'isaacbd_glow' || id === 'mono-red'
                ? { id: id === 'mono-red' ? 321 : id === 'isaacbd_glow' ? 123 : 123, slug: id === 'mono-red' ? 'mono-red' : id === 'isaacbd_glow' ? 'ibd_glow' : 'portra-400' }
                : null
        );
        findRelatedWhiteBalanceRecipesMock = vi.fn(async () => []);
        getCachedRecipeDetailMock = vi.fn(async () => baseDetail);
    });

    afterEach(() => { delete globalThis.React; });

    it('redirects uuid requests to the canonical slug path', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');
        await expect(
            mod.default({ params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }) })
        ).rejects.toThrow('REDIRECT:/recipes/portra-400');
    });

    it('redirects an old slug alias to the canonical slug path', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async () => ({ id: 123, slug: 'ibd_glow' }));
        getCachedRecipeDetailMock = vi.fn(async () => ({ ...baseDetail, id: 123, slug: 'ibd_glow' }));

        const mod = await import('../app/recipes/[id]/page.jsx');
        await expect(
            mod.default({ params: Promise.resolve({ id: 'isaacbd_glow' }) })
        ).rejects.toThrow('REDIRECT:/recipes/ibd_glow');
        expect(permanentRedirectMock).toHaveBeenCalledWith('/recipes/ibd_glow');
    });

    it('passes normalized monochrome settings to the recipe card', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async () => ({ id: 321, slug: 'mono-red' }));
        getCachedRecipeDetailMock = vi.fn(async () => ({
            ...baseDetail,
            id: 321,
            slug: 'mono-red',
            type: 'MONO',
            yellow: null,
            monochromeColor: 'Red Filter',
            monochromeColorStrength: 3,
            filmGrain: 'Strong',
            filmHue: 'Warm',
            monochromeVignetting: 'High',
            contrast: 2,
            whiteBalance2: 'Custom WB 1'
        }));

        const mod = await import('../app/recipes/[id]/page.jsx');
        await mod.default({ params: Promise.resolve({ id: 'mono-red' }) });

        expect(capturedRecipeCardProps.recipe).toEqual(
            expect.objectContaining({
                type: 'MONO', yellow: null, monochromeColor: 'Red Filter', monochromeColorStrength: 3,
                filmGrain: 'Strong', filmHue: 'Warm', monochromeVignetting: 'High', contrast: 2, whiteBalance2: 'Custom WB 1'
            })
        );
    });

    it('hydrates recipe media with asset-host URLs for the page loader', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');
        await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

        expect(capturedRecipeCardProps.recipe.comparisonImages[0]).toMatchObject({ id: 201, label: 'Before' });
        expect(capturedRecipeCardProps.recipe.sampleImages[0]).toMatchObject({ id: 301, isPrimary: true });
        // No eager saved-status query on this page load — see app/recipes/[id]/page.jsx.
        expect(capturedRecipeCardProps.recipe.isSaved).toBe(false);
    });

    it('resolves the id/slug/alias via the cached recipe index, not a live query', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');
        await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

        expect(resolveRecipeIndexEntryMock).toHaveBeenCalledWith('portra-400');
        expect(getCachedRecipeDetailMock).toHaveBeenCalledWith(123);
    });

    it('emits CreativeWork + ImageObject JSON-LD for the recipe', async () => {
        const originalBaseUrl = process.env.APP_BASE_URL;
        process.env.APP_BASE_URL = 'https://www.omrecipes.dev';
        try {
            const mod = await import('../app/recipes/[id]/page.jsx');
            const tree = await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

            const scripts = [];
            const walk = (node) => {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node)) return node.forEach(walk);
                if (node.type === 'script') scripts.push(node);
                walk(node.props?.children);
            };
            walk(tree);

            const ldScript = scripts.find((s) => s.props?.type === 'application/ld+json');
            expect(ldScript).toBeDefined();
            const data = JSON.parse(ldScript.props.dangerouslySetInnerHTML.__html.replace(/\\u003c/g, '<'));
            const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');
            expect(work.name).toBe('Portra 400');
            expect(work.url).toBe('https://www.omrecipes.dev/recipes/portra-400');
        } finally {
            process.env.APP_BASE_URL = originalBaseUrl;
        }
    });

    it('uses the asset host for recipe Open Graph images', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');
        const metadata = await mod.generateMetadata({ params: Promise.resolve({ id: 'portra-400' }) });
        expect(metadata.openGraph.images).toEqual([{ url: 'https://images.om-recipes.com/authors/a/recipes/r/sample.jpg' }]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-detail-page.test.js`
Expected: FAIL — `app/recipes/[id]/page.jsx` still imports `../db/index.ts`/`../lib/comments.js` the old way and doesn't call the new mocked functions.

- [ ] **Step 3: Rewrite `app/recipes/[id]/page.jsx`**

Replace lines 1-168 (everything from the top imports through the end of `getRecipeByIdOrSlug`) with:

```js
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '../../../lib/auth.js';
import { db } from '../../../db/index.ts';
import { authors } from '../../../db/schema.ts';
import { eq } from 'drizzle-orm';
import RecipeCard from '../../../components/recipe-card.jsx';
import SampleGallery from '../../../components/SampleGallery.jsx';
import CommentsSection from '../../../components/CommentsSection.jsx';
import { Badge } from '../../../components/ui/badge.jsx';
import { Card, CardContent } from '../../../components/ui/card.jsx';
import {
    addCommentAction,
    deleteCommentAction,
    deleteMyRecipeAction,
    deleteRecipeSampleImageAction,
    setPrimaryRecipeSampleImageAction,
    updateRecipeAction
} from './actions';
import { getSaveCountForRecipe } from '../../../lib/recipe-saves.js';
import { resolveRecipeIndexEntry, findRelatedWhiteBalanceRecipes } from '../../../lib/public-recipe-catalog.js';
import { getCachedRecipeDetail } from '../../../lib/recipe-detail-cache.js';
import { getRecipePath } from '../../../lib/recipe-url.js';
import { getEquivalentWhiteBalance } from '../../../lib/whiteBalanceEquivalence.js';
import { JsonLd } from '../../../components/JsonLd.jsx';
import { buildRecipeJsonLd } from '../../../lib/structured-data.js';

async function getRecipeByIdOrSlug(idOrSlug, userId = null) {
    const v = String(idOrSlug ?? '').trim();
    if (!v) return null;

    const indexEntry = await resolveRecipeIndexEntry(v);
    if (!indexEntry) return null;

    const detail = await getCachedRecipeDetail(indexEntry.id);
    if (!detail) return null;

    return {
        ...detail,
        viewerIsLoggedIn: userId != null,
        // No eager saved-status query: whether the viewer has saved this
        // recipe isn't shown until they toggle it (the save button asks the
        // server for the real state at that point, not this page).
        isSaved: false
    };
}
```

Then, further down, replace `getRelatedWhiteBalanceRecipes` (the whole function, currently lines 205-255) — delete it entirely, since `findRelatedWhiteBalanceRecipes` (imported above, from Task 1) replaces it.

Then in `export default async function Page({ params })`, replace:

```js
    const whiteBalance = getEquivalentWhiteBalance(recipe);
    const relatedWhiteBalanceRecipes = await getRelatedWhiteBalanceRecipes(recipe.id, whiteBalance, recipe.type);
```

with:

```js
    const whiteBalance = getEquivalentWhiteBalance(recipe);
    const relatedWhiteBalanceRecipes = await findRelatedWhiteBalanceRecipes(recipe.id, whiteBalance, recipe.type);
```

Leave `getAuthedAuthorIds` (lines 194-203) and everything from `export default async function Page` onward otherwise unchanged — `isUuidLike`/`recipeSlugAliases`/`recipeColorSettings`/`recipeMonoSettings`/`recipeComparisonImages`/`recipeSampleImages`/`ilike`/`ne`/`or`/`sql`/`hydrateRecipeImageRecord`/`cache` are no longer used directly by this file, so remove those now-unused imports too (`import { cache } from 'react'` and the trimmed `drizzle-orm`/schema imports in the block above already reflect this — double check no other function in the file still needs `and`, `asc`, `ilike`, `ne`, `or`, `sql`; `getAuthedAuthorIds` only needs `eq`, `getRelatedWhiteBalanceRecipes`'s replacement no longer needs any of them since it's deleted).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-detail-page.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS (this also catches any leftover unused imports in `page.jsx` step 3 missed)

- [ ] **Step 6: Commit**

```bash
git add app/recipes/\[id\]/page.jsx tests/recipe-detail-page.test.js
git commit -m "Serve the recipe detail page from the cached index + per-recipe detail cache"
```

---

### Task 4: Rewire the search route and homepage grid onto the index cache

**Files:**
- Modify: `app/recipes/search/route.js`
- Test: `tests/recipe-search-route.test.js`

**Interfaces:**
- Consumes: `getRecipeIndex` (`lib/public-recipe-catalog.js`, Task 1), `getSavedRecipeIdsForUser` (`lib/recipe-saves.js`, existing), `getSession` (`lib/auth.js`).
- Produces: same JSON response shape as today (`{ results, hasMore, nextOffset }`), same query params (`q`, `type`, `sort`, `limit`, `offset`, `onlyMine`, `onlySaved`).

- [ ] **Step 1: Update the failing test first**

Replace `tests/recipe-search-route.test.js` in full:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let getSessionMock;
let getRecipeIndexMock;
let getSavedRecipeIdsForUserMock;

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    getRecipeIndex: (...args) => getRecipeIndexMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    getSavedRecipeIdsForUser: (...args) => getSavedRecipeIdsForUserMock(...args)
}));

function makeRecipe(overrides) {
    return {
        id: 101, uuid: 'recipe-uuid', slug: 'portra-400', type: 'COLOR',
        recipeName: 'Portra 400', authorName: 'Author', description: 'Description',
        authorId: 9, authorUserId: 55, saveCount: 3,
        createdAt: new Date('2026-04-30T00:00:00Z'),
        comparisonImages: [{ id: 201, preparedObjectKey: 'authors/a/recipes/r/comparison.jpg', assetUrls: { original: 'https://images.om-recipes.com/authors/a/recipes/r/comparison.jpg' }, label: 'Before' }],
        sampleImages: [{ id: 301, preparedObjectKey: 'authors/a/recipes/r/sample.jpg', assetUrls: { original: 'https://images.om-recipes.com/authors/a/recipes/r/sample.jpg' }, isPrimary: true }],
        ...overrides
    };
}

describe('recipe search route', () => {
    beforeEach(() => {
        vi.resetModules();
        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set());
        getRecipeIndexMock = vi.fn(async () => [makeRecipe({})]);
    });

    it('returns hydrated comparison and sample images with no eager saved-status lookup', async () => {
        const { GET } = await import('../app/recipes/search/route.js');
        const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0'));
        const body = await response.json();

        expect(body.results).toHaveLength(1);
        expect(body.results[0].isSaved).toBe(false);
        expect(body.results[0].comparisonImages[0]).toMatchObject({ id: 201, label: 'Before' });
        expect(body.results[0].sampleImages[0]).toMatchObject({ id: 301, isPrimary: true });
        expect(getSavedRecipeIdsForUserMock).not.toHaveBeenCalled();
    });

    it('fetches the recipe index exactly once across two requests at different offsets', async () => {
        getRecipeIndexMock = vi.fn(async () =>
            Array.from({ length: 20 }, (_, i) => makeRecipe({ id: 100 + i, slug: `recipe-${i}`, recipeName: `Recipe ${i}` }))
        );
        const { GET } = await import('../app/recipes/search/route.js');

        const first = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0'));
        const second = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=12'));

        const firstBody = await first.json();
        const secondBody = await second.json();

        expect(firstBody.results).toHaveLength(12);
        expect(secondBody.results).toHaveLength(8);
        expect(secondBody.hasMore).toBe(false);
        expect(getRecipeIndexMock).toHaveBeenCalledTimes(2); // called per-request, but each call is a cache hit inside getRecipeIndex itself (Task 1) — this route never re-queries Postgres for a new offset
    });

    it('marks every result saved under the "saved" filter using a live saved-id lookup, not the index', async () => {
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set([101]));
        const { GET } = await import('../app/recipes/search/route.js');

        const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0&onlySaved=1'));
        const body = await response.json();

        expect(body.results).toHaveLength(1);
        expect(body.results[0].isSaved).toBe(true);
        expect(getSavedRecipeIdsForUserMock).toHaveBeenCalledWith({ userId: 42, recipeIds: [101] });
    });

    it('filters to only the requesting user\'s own recipes under onlyMine, with no DB call', async () => {
        getRecipeIndexMock = vi.fn(async () => [
            makeRecipe({ id: 101, authorUserId: 42 }),
            makeRecipe({ id: 102, authorUserId: 99 })
        ]);
        const { GET } = await import('../app/recipes/search/route.js');

        const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0&onlyMine=1'));
        const body = await response.json();

        expect(body.results.map((r) => r.id)).toEqual([101]);
    });

    it('returns an empty result set for onlyMine/onlySaved when logged out', async () => {
        getSessionMock = vi.fn(async () => null);
        const { GET } = await import('../app/recipes/search/route.js');

        const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0&onlySaved=1'));
        const body = await response.json();

        expect(body).toEqual({ results: [], hasMore: false, nextOffset: 0 });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-search-route.test.js`
Expected: FAIL — the route still imports `getPublicRecipeCatalog`/`fetchRecipeCatalog`.

- [ ] **Step 3: Rewrite `app/recipes/search/route.js`**

```js
import { getSession } from '../../../lib/auth.js';
import { getRecipeIndex } from '../../../lib/public-recipe-catalog.js';
import { getSavedRecipeIdsForUser } from '../../../lib/recipe-saves.js';
import { normalizeRecipeTypeFilter, RECIPE_TYPE_FILTER_VALUES } from '../../../lib/recipe-data.js';
import { normalizeRecipeSort, RECIPE_SORT_VALUES } from '../../../lib/recipe-sort.js';

function normalizeCatalogInput(searchParams) {
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 12), 1), 100);
    return {
        query: (searchParams.get('q') || '').toLowerCase(),
        recipeType: normalizeRecipeTypeFilter(searchParams.get('type')),
        sortBy: normalizeRecipeSort(searchParams.get('sort')),
        limit,
        offset: Math.max(Number(searchParams.get('offset') ?? 0), 0)
    };
}

function matchesQuery(recipe, query) {
    if (!query) return true;
    const haystack = `${recipe.recipeName} ${recipe.authorName} ${recipe.description ?? ''}`.toLowerCase();
    return haystack.includes(query);
}

function sortRecipes(recipes, sortBy) {
    const sorted = [...recipes];
    // Matches lib/public-recipe-catalog.js's original SQL orderBy tiebreak chains exactly:
    // OLDEST/NEWEST/AUTHOR/RECIPE_NAME end with saveCount desc, then id asc; the
    // default (SAVES) order ends with saveCount desc, createdAt desc, then id desc —
    // a different final tiebreak, so it can't share the same helper as the other four.
    const bySaveCountThenIdAsc = (a, b) => (b.saveCount - a.saveCount) || (a.id - b.id);

    if (sortBy === RECIPE_SORT_VALUES.OLDEST) {
        sorted.sort((a, b) => (a.createdAt - b.createdAt) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.NEWEST) {
        sorted.sort((a, b) => (b.createdAt - a.createdAt) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.AUTHOR) {
        sorted.sort((a, b) => a.authorName.localeCompare(b.authorName) || a.recipeName.localeCompare(b.recipeName) || bySaveCountThenIdAsc(a, b));
    } else if (sortBy === RECIPE_SORT_VALUES.RECIPE_NAME) {
        sorted.sort((a, b) => a.recipeName.localeCompare(b.recipeName) || a.authorName.localeCompare(b.authorName) || bySaveCountThenIdAsc(a, b));
    } else {
        sorted.sort((a, b) => (b.saveCount - a.saveCount) || (b.createdAt - a.createdAt) || (b.id - a.id));
    }
    return sorted;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const input = normalizeCatalogInput(searchParams);
    const onlyMine = searchParams.get('onlyMine') === '1';
    const onlySaved = searchParams.get('onlySaved') === '1';
    const session = await getSession();
    const userId = session?.user?.id ?? null;

    if ((onlyMine || onlySaved) && userId == null) {
        return Response.json({ results: [], hasMore: false, nextOffset: input.offset });
    }

    const index = await getRecipeIndex();

    let filtered = index.filter((recipe) => matchesQuery(recipe, input.query));
    if (input.recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) {
        filtered = filtered.filter((recipe) => recipe.type === input.recipeType);
    }
    if (onlyMine) {
        filtered = filtered.filter((recipe) => recipe.authorUserId === userId);
    }

    let savedRecipeIds = null;
    if (onlySaved) {
        savedRecipeIds = await getSavedRecipeIdsForUser({ userId, recipeIds: filtered.map((r) => r.id) });
        filtered = filtered.filter((recipe) => savedRecipeIds.has(recipe.id));
    }

    const sorted = sortRecipes(filtered, input.sortBy);
    const page = sorted.slice(input.offset, input.offset + input.limit);
    const hasMore = input.offset + input.limit < sorted.length;

    // No per-card saved-status lookup on the default/mine views: every result
    // under the "saved" filter is saved by construction, and outside that
    // filter we'd rather show no badge than pay a DB query on every default
    // page load.
    return Response.json({
        results: page.map((recipe) => ({
            ...recipe,
            viewerIsLoggedIn: userId != null,
            isSaved: onlySaved
        })),
        hasMore,
        nextOffset: input.offset + page.length
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-search-route.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/recipes/search/route.js tests/recipe-search-route.test.js
git commit -m "Serve the search/browse grid from the cached recipe index, not per-request queries"
```

---

### Task 5: Rewire the resolve route onto the index cache

**Files:**
- Modify: `app/recipes/resolve/route.js`
- Test: `tests/recipe-resolve-route.test.js`

**Interfaces:**
- Consumes: `resolveRecipeIndexEntry` (`lib/public-recipe-catalog.js`, Task 1).
- Produces: same response shape as today (`{ canonical }` or `{ error }`).

- [ ] **Step 1: Rewrite the existing test**

Replace `tests/recipe-resolve-route.test.js` in full:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let resolveRecipeIndexEntryMock;

vi.mock('../lib/public-recipe-catalog.js', () => ({
    resolveRecipeIndexEntry: (...args) => resolveRecipeIndexEntryMock(...args)
}));

async function call(url) {
    const mod = await import('../app/recipes/resolve/route.js');
    return mod.GET(new Request(url));
}

describe('GET /recipes/resolve', () => {
    beforeEach(() => {
        vi.resetModules();
        resolveRecipeIndexEntryMock = vi.fn(async () => null);
    });

    it('400s when recipe is missing', async () => {
        const res = await call('https://x.test/recipes/resolve');
        expect(res.status).toBe(400);
        expect(resolveRecipeIndexEntryMock).not.toHaveBeenCalled();
    });

    it('returns the slug unchanged for a current slug', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async () => ({ id: 123, slug: 'ibd_glow' }));
        const res = await call('https://x.test/recipes/resolve?recipe=ibd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('resolves an old alias to the canonical slug', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async (identifier) =>
            identifier === 'isaacbd_glow' ? { id: 123, slug: 'ibd_glow' } : null
        );
        const res = await call('https://x.test/recipes/resolve?recipe=isaacbd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('404s for an unknown identifier', async () => {
        const res = await call('https://x.test/recipes/resolve?recipe=nope');
        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-resolve-route.test.js`
Expected: FAIL

- [ ] **Step 3: Rewrite `app/recipes/resolve/route.js`**

```js
import { resolveRecipeIndexEntry } from '../../../lib/public-recipe-catalog.js';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const identifier = String(searchParams.get('recipe') ?? '').trim();

    if (!identifier) {
        return Response.json({ error: 'missing_identifier' }, { status: 400 });
    }

    const entry = await resolveRecipeIndexEntry(identifier);
    if (!entry) {
        return Response.json({ error: 'not_found' }, { status: 404 });
    }

    return Response.json({ canonical: entry.slug });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-resolve-route.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/recipes/resolve/route.js tests/recipe-resolve-route.test.js
git commit -m "Resolve recipe identifiers via the cached index instead of a live query"
```

---

### Task 6: Invalidate the per-recipe cache from `app/recipes/[id]/actions.js`

**Files:**
- Modify: `app/recipes/[id]/actions.js`
- Test: `tests/recipe-slug-rename-action.test.js`, `tests/recipe-comment-actions.test.js`

**Interfaces:**
- Consumes: `revalidateRecipeDetail` (`lib/public-recipe-catalog-cache.js`, Task 2).

- [ ] **Step 1: Update `tests/recipe-slug-rename-action.test.js`**

Add `revalidateRecipeDetailMock` alongside the existing `revalidateCatalogMock`:

```js
// change:
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: (...a) => revalidateCatalogMock(...a)
}));
// to:
let revalidateRecipeDetailMock;
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: (...a) => revalidateCatalogMock(...a),
    revalidateRecipeDetail: (...a) => revalidateRecipeDetailMock(...a)
}));
```

Initialize `revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());` in `beforeEach` alongside `revalidateCatalogMock`. Then add an assertion to the first `it()` block:

```js
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(123);
```

- [ ] **Step 2: Update `tests/recipe-comment-actions.test.js`**

Add mocks and assertions for both actions:

```js
// add alongside the other vi.mock calls:
let revalidateRecipeDetailMock;
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidateRecipeDetail: (...args) => revalidateRecipeDetailMock(...args)
}));
```

In the `addCommentAction` `describe` block's `beforeEach`, add `revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());`, and in the `'resolves the author, adds the comment, notifies the owner, and revalidates'` test add:

```js
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(123);
```

In the `deleteCommentAction` `describe` block's `beforeEach`, add the same mock initialization, and in `'resolves the requester author ids and deletes via lib/comments.js'` add the same assertion.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/recipe-slug-rename-action.test.js tests/recipe-comment-actions.test.js`
Expected: FAIL (both new assertions unmet; `revalidateRecipeDetail` isn't imported/called yet)

- [ ] **Step 4: Update `app/recipes/[id]/actions.js`**

Change the import line:

```js
// from:
import { revalidatePublicRecipeCatalog } from '../../../lib/public-recipe-catalog-cache.js';
// to:
import { revalidatePublicRecipeCatalog, revalidateRecipeDetail } from '../../../lib/public-recipe-catalog-cache.js';
```

In `updateRecipeAction`, change:

```js
    if (r) await revalidatePublicRecipeCatalog();
```
to:
```js
    if (r) {
        await revalidatePublicRecipeCatalog();
        await revalidateRecipeDetail(recipeId);
    }
```

In `deleteMyRecipeAction`, change:
```js
    if (deleted.length > 0) await revalidatePublicRecipeCatalog();
```
to:
```js
    if (deleted.length > 0) {
        await revalidatePublicRecipeCatalog();
        await revalidateRecipeDetail(recipeId);
    }
```

In `deleteRecipeSampleImageAction`, change:
```js
    await revalidatePublicRecipeCatalog();
    const recipe = recipeRows[0];
```
to:
```js
    await revalidatePublicRecipeCatalog();
    await revalidateRecipeDetail(parsedRecipeId);
    const recipe = recipeRows[0];
```

In `setPrimaryRecipeSampleImageAction`, change (same pattern):
```js
    await revalidatePublicRecipeCatalog();
    const recipe = recipeRows[0];
```
to:
```js
    await revalidatePublicRecipeCatalog();
    await revalidateRecipeDetail(parsedRecipeId);
    const recipe = recipeRows[0];
```

In `addCommentAction`, change:
```js
    await notifyRecipeCommented(parsedRecipeId, comment.id, author.id);

    revalidatePath(getRecipePath(recipe));
```
to:
```js
    await notifyRecipeCommented(parsedRecipeId, comment.id, author.id);

    await revalidateRecipeDetail(parsedRecipeId);
    revalidatePath(getRecipePath(recipe));
```

In `deleteCommentAction`, change:
```js
    await deleteComment({ commentId: parsedCommentId, requestingAuthorIds, recipeAuthorId: recipe.authorId });

    revalidatePath(getRecipePath(recipe));
```
to:
```js
    await deleteComment({ commentId: parsedCommentId, requestingAuthorIds, recipeAuthorId: recipe.authorId });

    await revalidateRecipeDetail(parsedRecipeId);
    revalidatePath(getRecipePath(recipe));
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npx vitest run tests/recipe-slug-rename-action.test.js tests/recipe-comment-actions.test.js`
Expected: PASS

- [ ] **Step 6: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/recipes/\[id\]/actions.js tests/recipe-slug-rename-action.test.js tests/recipe-comment-actions.test.js
git commit -m "Invalidate the per-recipe detail cache on every recipe/comment write"
```

---

### Task 7: Invalidate the per-recipe cache from `app/upload/actions.js`

**Files:**
- Modify: `app/upload/actions.js`
- Test: `tests/finalize-notify-sample-image.test.js`

**Interfaces:**
- Consumes: `revalidateRecipeDetail` (`lib/public-recipe-catalog-cache.js`, Task 2).

- [ ] **Step 1: Update `tests/finalize-notify-sample-image.test.js`**

Change:

```js
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve())
}));
```
to:
```js
let revalidateRecipeDetailMock;
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve()),
    revalidateRecipeDetail: (...args) => revalidateRecipeDetailMock(...args)
}));
```

Add `revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());` inside `beforeEach`, next to `notifySampleImageAddedMock = vi.fn(() => Promise.resolve());`. Then add an assertion to the existing (only) test:

```js
    it('calls notifySampleImageAdded with the recipe, image, and contributor author', async () => {
        await finalizeRecipeUploadAction({ parameters: { imageId: 100, originalFileSize: 100 } });

        expect(notifySampleImageAddedMock).toHaveBeenCalledWith(5, 100, 2);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(5);
    });
```

(The fixture's `preparedRecipeId: 5` and `finalizedAt: new Date()` mean this test exercises the "already finalized, `smallUrl` present" branch — the single `revalidatePublicRecipeCatalog()`/`revalidateRecipeDetail()` call pair around line 947 in the current source.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/finalize-notify-sample-image.test.js`
Expected: FAIL

- [ ] **Step 3: Update `app/upload/actions.js`**

Find the import (near the top, alongside other `lib/` imports) and change:

```js
import { revalidatePublicRecipeCatalog } from '../../lib/public-recipe-catalog-cache.js';
```
to:
```js
import { revalidatePublicRecipeCatalog, revalidateRecipeDetail } from '../../lib/public-recipe-catalog-cache.js';
```

Then at each of the three call sites in `finalizeRecipeUploadAction` (all three currently read `await revalidatePublicRecipeCatalog();` followed by a `return { ok: true, ... }`), add `await revalidateRecipeDetail(preparedRecipeId);` immediately after each `revalidatePublicRecipeCatalog()` call — there are three occurrences of this exact pattern in the function (around the `finalizedAt`-already-set early return, the `smallUrl`-already-present early return, and the final return at the end of the function). All three are inside `finalizeRecipeUploadAction` where `preparedRecipeId` is already in scope.

Also, in the earlier `prepareRecipeUploadAction` (or whichever function contains `if (shouldCreateRecipe) await revalidatePublicRecipeCatalog();` around line 811), change it to:
```js
        if (shouldCreateRecipe) {
            await revalidatePublicRecipeCatalog();
            await revalidateRecipeDetail(createdRecipeId);
        }
```
(`createdRecipeId` is already in scope there, per the surrounding code read earlier in this plan's research.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/finalize-notify-sample-image.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS. `tests/prepare-recipe-upload.test.js` does not mock `lib/public-recipe-catalog-cache.js` at all — it relies on the real module's `try/catch` no-op under `NODE_ENV=test` (Task 2 Step 4), the same way it already does for `revalidatePublicRecipeCatalog` today, so the new `revalidateRecipeDetail` call needs no change there.

- [ ] **Step 6: Commit**

```bash
git add app/upload/actions.js tests/finalize-notify-sample-image.test.js
git commit -m "Invalidate the per-recipe detail cache on sample-image upload/finalize"
```

---

### Task 8: Invalidate the per-recipe cache on profile updates and account deletion

**Files:**
- Modify: `app/profile/actions.js`
- Modify: `lib/privacy.js`
- Test: `tests/update-my-profile-action.test.js` (new — no test covers `updateMyProfileAction` today; `tests/notification-preferences-action.test.js` only covers the file's other export, `updateMyNotificationPreferencesAction`)
- Test: `tests/privacy-workflows.test.js`

**Interfaces:**
- Consumes: `revalidateRecipeDetail` (`lib/public-recipe-catalog-cache.js`, Task 2).

- [ ] **Step 1: Write the new failing test**

Create `tests/update-my-profile-action.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let updateMock;
let revalidatePathMock;
let revalidateCatalogMock;
let revalidateRecipeDetailMock;
let findOrCreateAuthorForUserMock;
let updateMyProfileAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'owner@example.com' } }),
    findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args),
    clearSessionCookie: vi.fn()
}));

vi.mock('../lib/notifications.js', () => ({ upsertNotificationPreferences: vi.fn() }));

vi.mock('../lib/privacy.js', () => ({
    startAccountDeletion: vi.fn(),
    startPrivacyExport: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: (...a) => revalidateCatalogMock(...a),
    revalidateRecipeDetail: (...a) => revalidateRecipeDetailMock(...a)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

function makeFormData(entries) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) {
        if (value != null) fd.set(key, value);
    }
    return fd;
}

describe('updateMyProfileAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        revalidatePathMock = vi.fn();
        revalidateCatalogMock = vi.fn(() => Promise.resolve());
        revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());
        findOrCreateAuthorForUserMock = vi.fn(() => Promise.resolve({ id: 77 }));

        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ id: 501 }, { id: 502 }]))
        }));
        updateMock = vi.fn(() => ({
            set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }))
        }));

        const mod = await import('../app/profile/actions.js');
        updateMyProfileAction = mod.updateMyProfileAction;
    });

    afterEach(() => vi.restoreAllMocks());

    it('busts the catalog cache and every one of the author\'s recipe-detail caches', async () => {
        await updateMyProfileAction(makeFormData({ name: 'New Name' }));

        expect(revalidateCatalogMock).toHaveBeenCalledTimes(1);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(501);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(502);
        expect(revalidatePathMock).toHaveBeenCalledWith('/profile');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/update-my-profile-action.test.js`
Expected: FAIL

- [ ] **Step 3: Update `app/profile/actions.js`**

Change the import:
```js
import { revalidatePublicRecipeCatalog } from '../../lib/public-recipe-catalog-cache.js';
```
to:
```js
import { revalidatePublicRecipeCatalog, revalidateRecipeDetail } from '../../lib/public-recipe-catalog-cache.js';
```

Add `recipes` to the existing `import { authors } from '../../db/schema.ts';` line, making it `import { authors, recipes } from '../../db/schema.ts';`.

In `updateMyProfileAction`, change:
```js
    await revalidatePublicRecipeCatalog();
    revalidatePath('/profile');
```
to:
```js
    await revalidatePublicRecipeCatalog();
    const authoredRecipeRows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.authorId, author.id));
    await Promise.all(authoredRecipeRows.map((row) => revalidateRecipeDetail(row.id)));
    revalidatePath('/profile');
```

- [ ] **Step 4: Run that test to verify it passes**

Run: `npx vitest run tests/update-my-profile-action.test.js`
Expected: PASS

- [ ] **Step 5: Update `tests/privacy-workflows.test.js`**

In the account-deletion test (the one asserting `expect(deleteMock).toHaveBeenCalledTimes(7)`), the 3rd `deleteHandlers` entry is the `recipes` delete. Change it from:

```js
        deleteHandlers.push(
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) })
        );
```
to:
```js
        deleteHandlers.push(
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 501 }, { id: 502 }])) })) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) })
        );
```

This file does not mock `lib/public-recipe-catalog-cache.js` at all today (it relies on the real module's `try/catch` no-op under `NODE_ENV=test`). Add a `let revalidateRecipeDetailMock;` declaration near the file's other `let` declarations at the top, add this new `vi.mock` call alongside the file's other `vi.mock(...)` calls:

```js
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve()),
    revalidateRecipeDetail: (...args) => revalidateRecipeDetailMock(...args)
}));
```

and add `revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());` in the file's `beforeEach`. Then add, after the existing `expect(deleteMock).toHaveBeenCalledTimes(7);`:

```js
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(501);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(502);
```

- [ ] **Step 6: Run the privacy test to verify it fails, then update `lib/privacy.js`**

Run: `npx vitest run tests/privacy-workflows.test.js`
Expected: FAIL

Change the import at the top of `lib/privacy.js`:
```js
import { revalidatePublicRecipeCatalog } from './public-recipe-catalog-cache.js';
```
to:
```js
import { revalidatePublicRecipeCatalog, revalidateRecipeDetail } from './public-recipe-catalog-cache.js';
```

In `eraseAccountData`, change:
```js
    if (authorIds.length > 0) {
        await db.delete(recipes).where(inArray(recipes.authorId, authorIds));
        await db.delete(authors).where(inArray(authors.id, authorIds));
        await revalidatePublicRecipeCatalog();
    }
```
to:
```js
    if (authorIds.length > 0) {
        const deletedRecipeRows = await db.delete(recipes).where(inArray(recipes.authorId, authorIds)).returning({ id: recipes.id });
        await db.delete(authors).where(inArray(authors.id, authorIds));
        await revalidatePublicRecipeCatalog();
        await Promise.all(deletedRecipeRows.map((row) => revalidateRecipeDetail(row.id)));
    }
```

- [ ] **Step 7: Run the privacy test to verify it passes**

Run: `npx vitest run tests/privacy-workflows.test.js`
Expected: PASS

- [ ] **Step 8: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/profile/actions.js lib/privacy.js tests/update-my-profile-action.test.js tests/privacy-workflows.test.js
git commit -m "Invalidate the per-recipe detail cache on profile updates and account deletion"
```

---

### Task 9: Manual verification

Not a code task — confirms the whole chain works end to end before considering this plan done.

- [ ] **Step 1: Start the app locally**

Run: `npm run dev` (or the project's usual local Neon-backed dev setup — check `README.md` for env vars if `.env.local` isn't already configured).

- [ ] **Step 2: Confirm the detail-page cache**

Open a recipe detail page twice (different browser tabs or a hard reload). Check `db/index.ts`'s temporary query logger output (`logger: true`, per its comment) in the terminal running `npm run dev`: the second view should log no new `select` queries for that recipe's data (comments included), only whatever `getAuthedAuthorIds` still does if logged in.

- [ ] **Step 3: Confirm the catalog pagination fix**

On the homepage, scroll through several pages of the infinite-scroll grid (default sort, no filters). Confirm only one initial batch of `select` queries appears in the dev server log for the whole session, not one batch per scroll page.

- [ ] **Step 4: Confirm invalidation**

Post a comment on a recipe, then reload that recipe's page — the new comment must appear (proves `revalidateRecipeDetail` actually busts the right tag). Edit a different recipe's name — the first recipe's cached page must still show its *old* data unless independently revalidated (proves invalidation is scoped per-recipe, not global).

- [ ] **Step 5: Record results in the PR/commit description**

No code change in this step — just note in the final PR body (when this branch is proposed for merge) that manual verification was performed, per the spec's Testing section.
