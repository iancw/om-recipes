import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let updateRecipeAction;
let selectMock;
let updateMock;
let revalidatePathMock;
let revalidateCatalogMock;
let applySlugChangeMock;
let resolveUniqueSlugMock;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } }),
    findOrCreateAuthorForUser: vi.fn()
}));
let revalidateRecipeDetailMock;
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: (...a) => revalidateCatalogMock(...a),
    revalidateRecipeDetail: (...a) => revalidateRecipeDetailMock(...a)
}));
vi.mock('../lib/comments.js', () => ({ addComment: vi.fn(), deleteComment: vi.fn() }));
vi.mock('../lib/notifications.js', () => ({ notifyRecipeCommented: vi.fn() }));
vi.mock('../lib/oci/deleteOrphanedImages.js', () => ({ deleteOrphanedImagesByIds: vi.fn() }));
// Keep fingerprint math out of the test — updateRecipeAction recomputes fingerprints
// from the settings row, which is irrelevant to slug behavior.
vi.mock('../lib/recipeFingerprint.js', () => ({
    computeRecipeFingerprint: () => 'fp',
    computeColorFingerprint: () => 'fp',
    computeColorToneFingerprint: () => 'fp',
    computeMonoFingerprint: () => 'fp',
    computeMonoNoWbFingerprint: () => 'fp',
    computeMonoToneFingerprint: () => 'fp',
    computeNoWbFingerprint: () => 'fp'
}));
vi.mock('../lib/recipe-slug.js', () => ({
    computeSlugBase: ({ authorName, recipeName }) => `${authorName}_${recipeName}`.toLowerCase().replace(/ /g, '-'),
    resolveUniqueSlug: (...a) => resolveUniqueSlugMock(...a),
    applySlugChange: (...a) => applySlugChangeMock(...a)
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a) => revalidatePathMock(...a) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...a) => selectMock(...a),
        update: (...a) => updateMock(...a)
    }
}));

function makeFormData(entries) {
    return { get: (k) => (k in entries ? entries[k] : null), has: (k) => k in entries };
}

describe('updateRecipeAction slug recompute', () => {
    beforeEach(async () => {
        vi.resetModules();
        revalidatePathMock = vi.fn();
        revalidateCatalogMock = vi.fn(() => Promise.resolve());
        revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());
        resolveUniqueSlugMock = vi.fn(({ base }) => Promise.resolve(base));
        applySlugChangeMock = vi.fn(({ oldSlug, newSlug }) =>
            Promise.resolve({ changed: oldSlug !== newSlug, newSlug })
        );

        // select() is called several times: author lookup, existing recipe, settings row.
        const responses = [
            [{ id: 5 }], // author row
            [{ id: 123, uuid: 'recipe-uuid', slug: 'jane_old-name', type: 'COLOR', authorName: 'Jane' }], // existing
            [{ contrast: 0 }] // settings row
        ];
        selectMock = vi.fn(() => {
            const res = responses.shift() ?? [];
            // Some lookups in updateRecipeAction await the query right after
            // `.where(...)` (no `.limit`), others chain `.limit(1)`. Make the
            // chain itself thenable so `await` resolves to `res` at any point.
            const chain = {
                from: vi.fn(() => chain),
                leftJoin: vi.fn(() => chain),
                where: vi.fn(() => chain),
                limit: vi.fn(() => Promise.resolve(res)),
                then: (resolve, reject) => Promise.resolve(res).then(resolve, reject)
            };
            return chain;
        });

        updateMock = vi.fn(() => {
            const chain = {
                set: vi.fn(() => chain),
                where: vi.fn(() => chain),
                returning: vi.fn(() => Promise.resolve([{ id: 123, uuid: 'recipe-uuid', slug: 'jane_old-name' }]))
            };
            return chain;
        });

        ({ updateRecipeAction } = await import('../app/recipes/[id]/actions.js'));
    });

    afterEach(() => vi.restoreAllMocks());

    it('records an alias and revalidates both paths when the name changes', async () => {
        await updateRecipeAction(
            makeFormData({ recipeId: '123', recipeName: 'New Name', description: '', sourceUrl: '' })
        );

        expect(resolveUniqueSlugMock).toHaveBeenCalledWith({ base: 'jane_new-name', recipeId: 123 });
        expect(applySlugChangeMock).toHaveBeenCalledWith({
            recipeId: 123,
            oldSlug: 'jane_old-name',
            newSlug: 'jane_new-name'
        });
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/jane_old-name');
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/jane_new-name');
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(123);
    });

    it('does not revalidate a second path when the slug is unchanged', async () => {
        applySlugChangeMock = vi.fn(() => Promise.resolve({ changed: false, newSlug: 'jane_old-name' }));
        resolveUniqueSlugMock = vi.fn(() => Promise.resolve('jane_old-name'));
        ({ updateRecipeAction } = await import('../app/recipes/[id]/actions.js'));

        await updateRecipeAction(
            makeFormData({ recipeId: '123', recipeName: 'Old Name', description: '', sourceUrl: '' })
        );

        const paths = revalidatePathMock.mock.calls.map((c) => c[0]);
        expect(new Set(paths)).toEqual(new Set(['/recipes/jane_old-name']));
    });
});
