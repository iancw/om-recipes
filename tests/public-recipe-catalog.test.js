import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

vi.mock('next/cache', () => ({
    // Mirrors production: unstable_cache JSON-serializes its cached payload,
    // so a cache hit returns a deep-equal-but-not-identical value (Dates
    // become ISO strings, etc). Storing the raw promise/value by reference
    // would hide bugs like createdAt-based sort arithmetic silently breaking
    // on every cache hit.
    unstable_cache: (fn, keyParts = []) => async (...args) => {
        const key = JSON.stringify([keyParts, args]);
        if (!cacheState.entries.has(key)) {
            cacheState.entries.set(key, Promise.resolve(fn(...args)).then((v) => JSON.parse(JSON.stringify(v))));
        }
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
        return makeSelectChain(responses[call++]);
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
        expect(second).toEqual(first); // deep-equal (JSON round-tripped like production), no re-fetch
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
                    { ...baseRecipeRow, id: 101, slug: 'a', recipeName: 'A', whiteBalanceTemperature: 5500, colorSettings: { ...baseRecipeRow.colorSettings, whiteBalanceTemperature: 5500 } },
                    { ...baseRecipeRow, id: 102, slug: 'b', recipeName: 'B', whiteBalanceTemperature: 5500, colorSettings: { ...baseRecipeRow.colorSettings, whiteBalanceTemperature: 5500 } },
                    { ...baseRecipeRow, id: 103, slug: 'c', recipeName: 'C', whiteBalanceTemperature: 4000, colorSettings: { ...baseRecipeRow.colorSettings, whiteBalanceTemperature: 4000 } }
                ],
                [],
                [],
                []
            ];
            let call = 0;
            selectMock.mockImplementation(() => makeSelectChain(responses[call++] ?? []));
            return makeSelectChain(responses[call++]);
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
