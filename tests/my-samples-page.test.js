import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSessionMock;
let mySamplesGridProps;

const makeSelectChain = (result) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
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

vi.mock('../components/MySamplesGrid.jsx', () => ({
    default: (props) => {
        mySamplesGridProps = props;
        return null;
    }
}));

vi.mock('../components/ui/badge.jsx', () => ({
    Badge: () => null
}));

vi.mock('../components/ui/button.jsx', () => ({
    buttonVariants: () => ''
}));

vi.mock('../components/ui/card.jsx', () => ({
    Card: ({ children }) => children ?? null,
    CardContent: ({ children }) => children ?? null,
    CardDescription: ({ children }) => children ?? null,
    CardHeader: ({ children }) => children ?? null,
    CardTitle: ({ children }) => children ?? null
}));

vi.mock('../app/my-samples/actions.js', () => ({
    deleteMySampleImageAction: vi.fn()
}));

describe('my samples page', () => {
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
        mySamplesGridProps = null;

        const selectResults = [
            [{ id: 7 }],
            [
                {
                    recipeId: 101,
                    recipeUuid: 'recipe-uuid',
                    recipeSlug: 'portra-400',
                    recipeName: 'Portra 400',
                    recipeAuthorName: 'Author',
                    image: {
                        id: 301,
                        preparedObjectKey: 'authors/a/recipes/r/sample.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/sample.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/sample.jpg'
                    }
                },
                {
                    recipeId: 101,
                    recipeUuid: 'recipe-uuid',
                    recipeSlug: 'portra-400',
                    recipeName: 'Portra 400',
                    recipeAuthorName: 'Author',
                    image: {
                        id: 302,
                        preparedObjectKey: 'authors/a/recipes/r/hidden-sample.jpg',
                        smallUrl: '/assets/images/320/authors/a/recipes/r/hidden-sample.jpg',
                        fullSizeUrl: '/assets/images/original/authors/a/recipes/r/hidden-sample.jpg',
                        copyright: false
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

    afterEach(() => {
        delete globalThis.React;
    });

    it('does not pass hidden images into the samples grid', async () => {
        const mod = await import('../app/my-samples/page.jsx');

        await mod.default();

        expect(mySamplesGridProps.samples).toHaveLength(1);
        expect(mySamplesGridProps.samples[0].image.id).toBe(301);
    });
});
