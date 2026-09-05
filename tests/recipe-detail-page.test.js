import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let getSessionMock;
let permanentRedirectMock;
let notFoundMock;
let resolveRecipeIndexEntryMock;
let findRelatedWhiteBalanceRecipesMock;
let getCachedRecipeDetailMock;
let getUserSavedStateMock;
let capturedRecipeCardProps;

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    getUserSavedState: (...args) => getUserSavedStateMock(...args)
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
        getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [], userId: 42, hydratedAt: 1 }));
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
        // Viewer's cached saved set doesn't include this recipe, so isSaved is false.
        expect(capturedRecipeCardProps.recipe.isSaved).toBe(false);
    });

    it('reflects true isSaved when the viewer has this recipe in their cached saved set', async () => {
        getSessionMock = vi.fn(async () => ({ user: { id: 42, uuid: 'user-uuid' } }));
        getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [123], userId: 42, hydratedAt: 1 }));

        const mod = await import('../app/recipes/[id]/page.jsx');
        await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

        expect(getUserSavedStateMock).toHaveBeenCalledWith('user-uuid', 42);
        expect(capturedRecipeCardProps.recipe.isSaved).toBe(true);
    });

    it('stays false and skips the cache lookup for a logged-out viewer', async () => {
        getSessionMock = vi.fn(async () => null);

        const mod = await import('../app/recipes/[id]/page.jsx');
        await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

        expect(getUserSavedStateMock).not.toHaveBeenCalled();
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
