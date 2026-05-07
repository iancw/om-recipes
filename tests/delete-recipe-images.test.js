import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let deleteMyRecipeAction;

let selectMock;
let deleteMock;

let deleteObjectMock;
let getClientMock;
let getNamespaceMock;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } })
}));

// --- OCI mock
vi.mock('../lib/oci/objectStorage.js', () => ({
    deleteObject: (...args) => deleteObjectMock(...args),
    getObjectStorageClientFromEnv: () => getClientMock(),
    getObjectStorageNamespaceFromEnv: () => getNamespaceMock()
}));

// --- db mock
vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

// next/navigation and next/cache exports can be non-configurable in test env;
// mock the full modules up-front.
vi.mock('next/navigation', () => ({
    redirect: () => {}
}));

vi.mock('next/cache', () => ({
    revalidatePath: () => {}
}));

function makeFormData(obj) {
    return {
        get: (k) => obj[k]
    };
}

describe('deleteMyRecipeAction image cleanup', () => {
    beforeEach(async () => {
        vi.resetModules();

        deleteObjectMock = vi.fn().mockResolvedValue({});
        getClientMock = vi.fn(() => ({}));
        getNamespaceMock = vi.fn(() => 'namespace');

        // SELECT call order in deleteMyRecipeAction:
        // 1) authorRows
        // 2) recipeRows
        // 3) sampleImageIds
        // 4) comparisonImageIds
        // 5) stillSample (after delete)
        // 6) stillComparison
        // 7) orphanedImages
        const selectResponses = [
            // authorRows
            [{ id: 9 }],
            // recipeRows
            [{ id: 123, authorId: 9, recipeName: 'My Recipe' }],
            // sampleImageIds
            [{ imageId: 777 }],
            // comparisonImageIds
            [],
            // stillSample
            [],
            // stillComparison
            [],
            // orphanedImages
            [
                {
                    id: 777,
                    preparedObjectKey: 'authors/a/recipes/s1/img.jpg',
                    fullSizeUrl: '/assets/images/original/authors/a/recipes/s1/img.jpg',
                    smallUrl: '/assets/images/600/authors/a/recipes/s1/img.jpg'
                }
            ]
        ];

        selectMock = vi.fn(() => {
            const res = selectResponses.shift();
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn(() => Promise.resolve(res)),
                then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
            };
            return chain;
        });

        const deleteReturningMock = vi.fn(() => Promise.resolve([{ id: 123 }]));
        const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
        deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

        const mod = await import('../app/recipes/[id]/actions.js');
        deleteMyRecipeAction = mod.deleteMyRecipeAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('deletes every configured processed rendition for orphaned images', async () => {
        await deleteMyRecipeAction(
            makeFormData({
                recipeId: '123',
                confirmName: 'My Recipe'
            })
        );

        const objectNames = deleteObjectMock.mock.calls.map((c) => c[0].objectName);

        expect(objectNames).toContain('authors/a/recipes/s1/img.jpg');
        expect(objectNames).toContain('320/authors/a/recipes/s1/img.jpg');
        expect(objectNames).toContain('640/authors/a/recipes/s1/img.jpg');
        expect(objectNames).toContain('960/authors/a/recipes/s1/img.jpg');
        expect(objectNames).toContain('1200/authors/a/recipes/s1/img.jpg');
        expect(objectNames).toContain('1600/authors/a/recipes/s1/img.jpg');
    });
});
