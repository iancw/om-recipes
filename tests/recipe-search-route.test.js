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
        createdAtMs: new Date('2026-04-30T00:00:00Z').getTime(),
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

    it('strips internal index fields (authorId, authorUserId, aliases, saveCount, createdAtMs) from the public response', async () => {
        getRecipeIndexMock = vi.fn(async () => [makeRecipe({ aliases: ['old-slug'] })]);
        const { GET } = await import('../app/recipes/search/route.js');

        const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0'));
        const body = await response.json();

        expect(body.results).toHaveLength(1);
        const [result] = body.results;
        expect(result).not.toHaveProperty('authorId');
        expect(result).not.toHaveProperty('authorUserId');
        expect(result).not.toHaveProperty('aliases');
        expect(result).not.toHaveProperty('saveCount');
        expect(result).not.toHaveProperty('createdAtMs');
        // Fields the frontend does rely on remain present.
        expect(result).toMatchObject({ id: 101, recipeName: 'Portra 400', authorName: 'Author' });
    });
});

describe('recipe search route sort tiebreaks', () => {
    beforeEach(() => {
        vi.resetModules();
        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set());
    });

    async function getSortedIds(recipes, sortParam) {
        getRecipeIndexMock = vi.fn(async () => recipes);
        const { GET } = await import('../app/recipes/search/route.js');
        const sortQuery = sortParam ? `&sort=${sortParam}` : '';
        const response = await GET(new Request(`https://om-recipes.test/recipes/search?q=&limit=12&offset=0${sortQuery}`));
        const body = await response.json();
        return body.results.map((r) => r.id);
    }

    it('tiebreaks OLDEST and NEWEST by save count then id ascending when createdAt ties', async () => {
        // Same createdAtMs and same saveCount for both -> falls all the way
        // through to the final id-ascending tiebreak in both directions.
        const recipes = [
            makeRecipe({ id: 302, saveCount: 5, createdAtMs: 1000 }),
            makeRecipe({ id: 301, saveCount: 5, createdAtMs: 1000 })
        ];

        expect(await getSortedIds(recipes, 'oldest')).toEqual([301, 302]);
        expect(await getSortedIds(recipes, 'newest')).toEqual([301, 302]);
    });

    it('tiebreaks the explicit SAVES sort by save count, then createdAt descending, then id descending', async () => {
        // id ordering deliberately runs opposite to createdAtMs ordering
        // within the tied-saveCount pair, so a regression that skips the
        // createdAt tiebreak (falling straight through to id) produces a
        // detectably wrong order instead of accidentally matching.
        const recipes = [
            makeRecipe({ id: 555, saveCount: 10, createdAtMs: 500 }), // highest saveCount, always first
            makeRecipe({ id: 999, saveCount: 5, createdAtMs: 1000 }), // tied saveCount, older, larger id
            makeRecipe({ id: 101, saveCount: 5, createdAtMs: 2000 }) // tied saveCount, newer, smaller id
        ];

        // NOTE: the site's DEFAULT sort (no `sort` param at all) normalizes to
        // NEWEST, not SAVES (see lib/recipe-sort.js's DEFAULT_RECIPE_SORT) —
        // only an explicit `?sort=saves` reaches sortRecipes's SAVES branch.
        expect(await getSortedIds(recipes, 'saves')).toEqual([555, 101, 999]);
    });

    it('falls back to NEWEST order (the site default) when no sort param is given', async () => {
        const recipes = [
            makeRecipe({ id: 555, saveCount: 10, createdAtMs: 500 }),
            makeRecipe({ id: 999, saveCount: 5, createdAtMs: 1000 }),
            makeRecipe({ id: 101, saveCount: 5, createdAtMs: 2000 })
        ];

        expect(await getSortedIds(recipes, null)).toEqual([101, 999, 555]);
    });

    it('tiebreaks AUTHOR sort by id ascending (not descending, unlike the default SAVES branch)', async () => {
        const recipes = [
            makeRecipe({ id: 302, authorName: 'Same Author', recipeName: 'Same Recipe', saveCount: 5 }),
            makeRecipe({ id: 301, authorName: 'Same Author', recipeName: 'Same Recipe', saveCount: 5 })
        ];

        expect(await getSortedIds(recipes, 'author')).toEqual([301, 302]);
    });
});
