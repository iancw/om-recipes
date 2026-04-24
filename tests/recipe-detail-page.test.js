import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSessionMock;
let getSavedRecipeIdsForUserMock;
let permanentRedirectMock;
let notFoundMock;

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

vi.mock('../lib/whiteBalanceEquivalence.js', () => ({
    getEquivalentWhiteBalance: vi.fn(() => null)
}));

vi.mock('next/navigation', () => ({
    notFound: (...args) => notFoundMock(...args),
    permanentRedirect: (...args) => permanentRedirectMock(...args)
}));

vi.mock('../components/recipe-card.jsx', () => ({
    default: () => null
}));

vi.mock('../components/SampleGallery.jsx', () => ({
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
    deleteMyRecipeAction: vi.fn(),
    deleteRecipeSampleImageAction: vi.fn(),
    setPrimaryRecipeSampleImageAction: vi.fn(),
    updateRecipeAction: vi.fn()
}));

describe('recipe detail page redirects', () => {
    beforeEach(() => {
        vi.resetModules();

        getSessionMock = vi.fn(async () => ({ user: { id: 42 } }));
        getSavedRecipeIdsForUserMock = vi.fn(async () => new Set());
        notFoundMock = vi.fn(() => {
            throw new Error('NOT_FOUND');
        });
        permanentRedirectMock = vi.fn((location) => {
            throw new Error(`REDIRECT:${location}`);
        });

        const selectResults = [
            [
                {
                    id: 123,
                    uuid: '123e4567-e89b-12d3-a456-426614174000',
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
                    authorId: 9,
                    authorSocial: {
                        instagram: null,
                        flickr: null,
                        website: null,
                        kofi: null
                    }
                }
            ],
            [],
            []
        ];

        selectMock = vi.fn(() => {
            if (selectResults.length === 0) {
                throw new Error('Unexpected select call');
            }
            return makeSelectChain(selectResults.shift());
        });
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
});
