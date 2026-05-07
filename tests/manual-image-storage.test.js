import { describe, expect, it } from 'vitest';

describe('manual image storage helpers', () => {
    it('builds canonical object keys for non-comparison images', async () => {
        const { buildManualImageObjectKey } = await import('../scripts/manual-image-storage.mjs');

        expect(
            buildManualImageObjectKey({
                authorUuid: 'author_uuid-123',
                recipeSlug: 'author_recipe-name',
                fileName: 'Lighthouse Final.JPG',
                comparisonLabel: null
            })
        ).toBe('authors/author_uuid-123/recipes/author_recipe-name/lighthouse-final.jpg');
    });

    it('builds canonical object keys for comparison images', async () => {
        const { buildManualImageObjectKey } = await import('../scripts/manual-image-storage.mjs');

        expect(
            buildManualImageObjectKey({
                authorUuid: 'author_uuid-123',
                recipeSlug: 'author_recipe-name',
                fileName: 'ignored-name.jpg',
                comparisonLabel: 'Watch Hill'
            })
        ).toBe('authors/author_uuid-123/recipes/author_recipe-name/comparisons/watch-hill.jpg');
    });

    it('returns the original plus fixed derivative object names', async () => {
        const { expectedImageObjects } = await import('../scripts/manual-image-storage.mjs');

        expect(expectedImageObjects('authors/a/recipes/r/sample.jpg')).toEqual([
            'authors/a/recipes/r/sample.jpg',
            '320/authors/a/recipes/r/sample.jpg',
            '640/authors/a/recipes/r/sample.jpg',
            '960/authors/a/recipes/r/sample.jpg',
            '1200/authors/a/recipes/r/sample.jpg',
            '1600/authors/a/recipes/r/sample.jpg'
        ]);
    });
});
