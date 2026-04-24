import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let setPrimaryRecipeSampleImageAction;

let selectMock;
let updateMock;
let revalidatePathMock;
let updateCalls;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } })
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

describe('setPrimaryRecipeSampleImageAction', () => {
    beforeEach(async () => {
        vi.resetModules();

        revalidatePathMock = vi.fn();
        updateCalls = [];

        const selectResponses = [
            [{ id: 9 }],
            [{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug' }],
            [{ imageId: 456 }]
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

        updateMock = vi.fn(() => {
            const call = {};
            updateCalls.push(call);
            return {
                set: vi.fn((values) => {
                    call.values = values;
                    return {
                        where: vi.fn(() => Promise.resolve())
                    };
                })
            };
        });

        const mod = await import('../app/recipes/[id]/actions.js');
        setPrimaryRecipeSampleImageAction = mod.setPrimaryRecipeSampleImageAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('allows the recipe owner to choose the overview sample image', async () => {
        await setPrimaryRecipeSampleImageAction({ recipeId: 123, imageId: 456 });

        expect(updateMock).toHaveBeenCalledTimes(2);
        expect(updateCalls).toHaveLength(2);
        expect(updateCalls[0].values).toEqual({ isPrimary: false });
        expect(updateCalls[1].values).toEqual({ isPrimary: true });
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/recipe-slug');
        expect(revalidatePathMock).toHaveBeenCalledWith('/');
    });
});
