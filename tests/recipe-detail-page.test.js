import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSessionMock;
let getSavedRecipeIdsForUserMock;
let permanentRedirectMock;
let notFoundMock;
let capturedRecipeCardProps;

const makeSelectChain = (result) => ({
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
});

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

vi.mock('../lib/comments.js', () => ({
    getCommentsForRecipe: vi.fn(async () => [])
}));

vi.mock('../lib/whiteBalanceEquivalence.js', () => ({
    getEquivalentWhiteBalance: vi.fn(() => null)
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

vi.mock('../components/SampleGallery.jsx', () => ({
    default: () => null
}));

vi.mock('../components/CommentsSection.jsx', () => ({
    default: () => null
}));

vi.mock('../components/ui/badge.jsx', () => ({
    Badge: () => null
}));

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

describe('recipe detail page redirects', () => {
    beforeEach(() => {
        vi.resetModules();
        globalThis.React = {
            createElement: vi.fn((type, props, ...children) => {
                const resolvedProps = {
                    ...(props ?? {}),
                    ...(children.length > 0 ? { children: children.length === 1 ? children[0] : children } : {})
                };

                if (typeof type === 'function') {
                    return type(resolvedProps);
                }

                return { type, props: resolvedProps };
            })
        };

        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set());
        notFoundMock = vi.fn(() => {
            throw new Error('NOT_FOUND');
        });
        permanentRedirectMock = vi.fn((location) => {
            throw new Error(`REDIRECT:${location}`);
        });
        capturedRecipeCardProps = null;

        const selectResults = [
            [
                {
                    id: 123,
                    uuid: '123e4567-e89b-12d3-a456-426614174000',
                    slug: 'portra-400',
                    type: 'COLOR',
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
                    authorId: 9,
                    authorSocial: {
                        instagram: null,
                        flickr: null,
                        website: null,
                        kofi: null
                    },
                    colorSettings: {
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
                        whiteBalanceGreenOffset: 0
                    },
                    monoSettings: null
                }
            ],
            [
                {
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
                },
                {
                    label: 'Hidden',
                    image: {
                        id: 202,
                        preparedObjectKey: 'authors/a/recipes/r/hidden-comparison.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/hidden-comparison.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/hidden-comparison.jpg',
                        dimensions: { width: 320, height: 200 },
                        camera: 'OM-3',
                        lens: '25mm',
                        copyright: false
                    }
                }
            ],
            [
                {
                    image: {
                        id: 300,
                        preparedObjectKey: 'authors/a/recipes/r/hidden-primary.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/hidden-primary.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/hidden-primary.jpg',
                        dimensions: { width: 320, height: 200 },
                        camera: 'OM-3',
                        lens: '25mm',
                        validExif: true,
                        copyright: false
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
                },
                {
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
            ],
            []
        ];

        selectMock = vi.fn(() => {
            if (selectResults.length === 0) {
                throw new Error('Unexpected select call');
            }
            return makeSelectChain(selectResults.shift());
        });
    });

    afterEach(() => {
        delete globalThis.React;
    });

    it('redirects uuid requests to the canonical slug path', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');

        await expect(
            mod.default({
                params: Promise.resolve({
                    id: '123e4567-e89b-12d3-a456-426614174000'
                })
            })
        ).rejects.toThrow('REDIRECT:/recipes/portra-400');
    });

    it('passes normalized monochrome settings to the recipe card', async () => {
        selectMock = vi.fn(() =>
            makeSelectChain([
                {
                    id: 321,
                    uuid: '223e4567-e89b-12d3-a456-426614174000',
                    slug: 'mono-red',
                    type: 'MONO',
                    recipeName: 'Mono Red',
                    authorName: 'Author',
                    description: 'Description',
                    sourceUrl: null,
                    yellow: 5,
                    contrast: -1,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    shadingEffect: 0,
                    exposureCompensation: 0,
                    whiteBalance2: 'Auto',
                    whiteBalanceTemperature: null,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0,
                    authorId: 9,
                    authorSocial: {
                        instagram: null,
                        flickr: null,
                        website: null,
                        kofi: null
                    },
                    colorSettings: null,
                    monoSettings: {
                        monochromeProfile: 'Monochrome Profile 2',
                        monochromeColor: 'Red Filter',
                        monochromeColorStrength: 3,
                        filmGrain: 'Strong',
                        filmHue: 'Warm',
                        monochromeVignetting: 'High',
                        contrast: 2,
                        sharpness: 1,
                        highlights: 1,
                        shadows: -1,
                        midtones: 0,
                        shadingEffect: 1,
                        exposureCompensation: 0,
                        whiteBalance2: 'Custom WB 1',
                        whiteBalanceTemperature: 5200,
                        whiteBalanceAmberOffset: 1,
                        whiteBalanceGreenOffset: -1
                    }
                }
            ])
        );

        const mod = await import('../app/recipes/[id]/page.jsx');

        await mod.default({
            params: Promise.resolve({
                id: 'mono-red'
            })
        });

        expect(capturedRecipeCardProps.recipe).toEqual(
            expect.objectContaining({
                type: 'MONO',
                yellow: null,
                monochromeColor: 'Red Filter',
                monochromeColorStrength: 3,
                filmGrain: 'Strong',
                filmHue: 'Warm',
                monochromeVignetting: 'High',
                contrast: 2,
                whiteBalance2: 'Custom WB 1'
            })
        );
    });

    it('hydrates recipe media with asset-host URLs for the page loader', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');

        await mod.default({
            params: Promise.resolve({
                id: 'portra-400'
            })
        });

        expect(capturedRecipeCardProps.recipe.comparisonImages[0]).toMatchObject({
            id: 201,
            preparedObjectKey: 'authors/a/recipes/r/comparison.jpg',
            assetUrls: {
                original: 'https://images.om-recipes.com/authors/a/recipes/r/comparison.jpg'
            },
            label: 'Before'
        });
        expect(capturedRecipeCardProps.recipe.sampleImages[0]).toMatchObject({
            id: 301,
            preparedObjectKey: 'authors/a/recipes/r/sample.jpg',
            assetUrls: {
                original: 'https://images.om-recipes.com/authors/a/recipes/r/sample.jpg'
            },
            isPrimary: true
        });
        expect(capturedRecipeCardProps.recipe.comparisonImages).toHaveLength(1);
        expect(capturedRecipeCardProps.recipe.sampleImages).toHaveLength(1);
    });

    it('uses the asset host for recipe Open Graph images', async () => {
        const mod = await import('../app/recipes/[id]/page.jsx');

        const metadata = await mod.generateMetadata({
            params: Promise.resolve({
                id: 'portra-400'
            })
        });

        expect(metadata.openGraph.images).toEqual([
            {
                url: 'https://images.om-recipes.com/authors/a/recipes/r/sample.jpg'
            }
        ]);
    });
});
