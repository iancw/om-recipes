import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSessionMock;
let getSavedRecipeIdsForUserMock;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    getSavedRecipeIdsForUser: (...args) => getSavedRecipeIdsForUserMock(...args)
}));

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
}

describe('recipe search route', () => {
    beforeEach(() => {
        vi.resetModules();

        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set([101]));

        const selectResults = [
            [
                {
                    id: 101,
                    uuid: 'recipe-uuid',
                    slug: 'portra-400',
                    recipeName: 'Portra 400',
                    authorName: 'Author',
                    description: 'Description',
                    sourceUrl: null,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    shadingEffect: 0,
                    exposureCompensation: 0,
                    whiteBalance2: null,
                    whiteBalanceTemperature: null,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0,
                    createdAt: new Date('2026-04-30T00:00:00Z'),
                    authorSocial: {
                        instagram: null,
                        flickr: null,
                        website: null,
                        kofi: null
                    },
                    saveCount: 3
                }
            ],
            [
                {
                    recipeId: 101,
                    label: 'Before',
                    image: {
                        id: 201,
                        preparedObjectKey: 'authors/a/recipes/r/comparison.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/comparison.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/comparison.jpg',
                        dimensions: { width: 320, height: 200 },
                        camera: 'OM-3',
                        lens: '25mm'
                    }
                }
            ],
            [
                {
                    recipeId: 101,
                    image: {
                        id: 301,
                        preparedObjectKey: 'authors/a/recipes/r/sample.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/sample.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/sample.jpg',
                        dimensions: { width: 320, height: 200 },
                        camera: 'OM-3',
                        lens: '25mm',
                        validExif: true
                    },
                    isPrimary: true,
                    author: {
                        id: 9,
                        uuid: 'author-uuid',
                        name: 'Photographer',
                        instagramLink: null,
                        flickrLink: null,
                        website: null,
                        kofiLink: null
                    }
                }
            ]
        ];

        selectMock = vi.fn(() => {
            if (selectResults.length === 0) {
                throw new Error('Unexpected select call');
            }
            return makeSelectChain(selectResults.shift());
        });
    });

    it('returns hydrated comparison and sample images with asset-host URLs', async () => {
        const { GET } = await import('../app/recipes/search/route.js');

        const response = await GET(
            new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0')
        );
        const body = await response.json();

        expect(body.results).toHaveLength(1);
        expect(body.results[0].comparisonImages[0]).toMatchObject({
            id: 201,
            preparedObjectKey: 'authors/a/recipes/r/comparison.jpg',
            assetUrls: {
                original: 'https://images.om-recipes.com/original/authors/a/recipes/r/comparison.jpg'
            },
            label: 'Before'
        });
        expect(body.results[0].sampleImages[0]).toMatchObject({
            id: 301,
            preparedObjectKey: 'authors/a/recipes/r/sample.jpg',
            assetUrls: {
                original: 'https://images.om-recipes.com/original/authors/a/recipes/r/sample.jpg'
            },
            isPrimary: true
        });
    });
});
