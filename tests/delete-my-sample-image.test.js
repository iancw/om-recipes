import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let deleteMySampleImageAction;

let selectMock;
let deleteMock;
let revalidatePathMock;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } })
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    deleteObject: vi.fn(),
    getObjectStorageClientFromEnv: vi.fn(() => ({})),
    getObjectStorageNamespaceFromEnv: vi.fn(() => 'namespace')
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

describe('deleteMySampleImageAction', () => {
    beforeEach(async () => {
        vi.resetModules();

        revalidatePathMock = vi.fn();

        const selectResponses = [
            [{ id: 88 }],
            [{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug' }],
            [{ imageId: 456 }],
            []
        ];

        selectMock = vi.fn(() => {
            const res = selectResponses.shift();
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                limit: vi.fn(() => Promise.resolve(res)),
                then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
            };
            return chain;
        });

        const deleteResponses = [
            [{ imageId: 456 }]
        ];

        deleteMock = vi.fn(() => ({
            where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve(deleteResponses.shift() ?? []))
            }))
        }));

        const mod = await import('../app/my-samples/actions.js');
        deleteMySampleImageAction = mod.deleteMySampleImageAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('allows the sample uploader to remove their sample image association', async () => {
        await deleteMySampleImageAction({ recipeId: 123, imageId: 456 });

        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/recipe-slug');
        expect(revalidatePathMock).toHaveBeenCalledWith('/');
        expect(revalidatePathMock).toHaveBeenCalledWith('/my-samples');
    });
});
