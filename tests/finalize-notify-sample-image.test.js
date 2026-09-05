import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let updateMock;
let notifySampleImageAddedMock;
let finalizeRecipeUploadAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'owner@example.com' } })
}));

vi.mock('../lib/notifications.js', () => ({
    notifySampleImageAdded: (...args) => notifySampleImageAddedMock(...args)
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: vi.fn(() => ({})),
    getObjectStorageNamespaceFromEnv: vi.fn(() => 'ns'),
    headObject: vi.fn(() => Promise.resolve({ contentLength: 100 })),
    getObject: vi.fn(),
    createPreauthenticatedRequest: vi.fn(),
    deleteObject: vi.fn()
}));

let revalidateRecipeDetailMock;
vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve()),
    revalidateRecipeDetail: (...args) => revalidateRecipeDetailMock(...args)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

describe('finalizeRecipeUploadAction notifies on sample image add', () => {
    beforeEach(async () => {
        vi.resetModules();
        notifySampleImageAddedMock = vi.fn(() => Promise.resolve());
        revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());

        // First select: the image + author join lookup inside finalizeRecipeUploadAction.
        selectMock = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() =>
                Promise.resolve([
                    {
                        id: 100,
                        authorId: 2,
                        authorUserId: 9,
                        smallUrl: 'https://cdn/small.jpg',
                        fullSizeUrl: 'https://cdn/full.jpg',
                        sha256Hash: 'abc',
                        originalFileSize: 100,
                        preparedRecipeId: 5,
                        preparedObjectKey: 'authors/a/recipes/r/img.jpg',
                        finalizedAt: new Date()
                    }
                ])
            )
        }));

        insertMock = vi.fn(() => ({
            values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) }))
        }));
        updateMock = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }));

        const mod = await import('../app/upload/actions.js');
        finalizeRecipeUploadAction = mod.finalizeRecipeUploadAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls notifySampleImageAdded with the recipe, image, and contributor author', async () => {
        await finalizeRecipeUploadAction({ parameters: { imageId: 100, originalFileSize: 100 } });

        expect(notifySampleImageAddedMock).toHaveBeenCalledWith(5, 100, 2);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(5);
    });
});
