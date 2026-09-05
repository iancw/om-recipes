import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getCommentsForRecipeMock;
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
        expect(second).toEqual(first); // deep-equal (JSON round-tripped like production), not the same instance
        expect(selectMock).toHaveBeenCalledTimes(3); // one fetch, not two
        expect(getCommentsForRecipeMock).toHaveBeenCalledTimes(1);
    });

    it('returns null when the recipe row is missing', async () => {
        selectMock = vi.fn(() => makeSelectChain([]));
        const { getCachedRecipeDetail } = await import('../lib/recipe-detail-cache.js');

        expect(await getCachedRecipeDetail(999)).toBeNull();
    });
});
