import { describe, expect, it, vi } from 'vitest';

const revalidateTagMock = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...args) => revalidateTagMock(...args) }));

describe('recipeDetailTag / revalidateRecipeDetail', () => {
    it('builds a stable per-recipe tag string', async () => {
        const { recipeDetailTag } = await import('../lib/public-recipe-catalog-cache.js');
        expect(recipeDetailTag(123)).toBe('recipe-detail:123');
    });

    it('revalidates only that recipe\'s tag', async () => {
        const { revalidateRecipeDetail } = await import('../lib/public-recipe-catalog-cache.js');
        await revalidateRecipeDetail(123);
        expect(revalidateTagMock).toHaveBeenCalledWith('recipe-detail:123', 'max');
    });
});
