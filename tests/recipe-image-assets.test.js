import { describe, expect, it } from 'vitest';
import {
    RECIPE_IMAGE_RENDITIONS,
    buildRecipeImageAssetUrl,
    getRecipeImageObjectKey,
    hydrateRecipeImageRecord
} from '../lib/recipe-image-assets.js';

describe('recipe image asset helpers', () => {
    it('builds asset-host URLs for every supported rendition', () => {
        const objectKey = 'authors/a/recipes/r/image.jpg';

        expect(RECIPE_IMAGE_RENDITIONS).toEqual(['320', '640', '960', '1200', '1600', 'original']);
        expect(
            buildRecipeImageAssetUrl({
                assetHost: 'https://images.om-recipes.com',
                objectKey,
                rendition: '960'
            })
        ).toBe('https://images.om-recipes.com/960/authors/a/recipes/r/image.jpg');
    });

    it('prefers preparedObjectKey and falls back to legacy assets URLs', () => {
        expect(
            getRecipeImageObjectKey({
                preparedObjectKey: 'authors/a/recipes/r/image.jpg'
            })
        ).toBe('authors/a/recipes/r/image.jpg');

        expect(
            getRecipeImageObjectKey({
                fullSizeUrl: '/assets/images/original/authors/a/recipes/r/image.jpg'
            })
        ).toBe('authors/a/recipes/r/image.jpg');
    });

    it('hydrates image rows with deterministic asset URLs', () => {
        expect(
            hydrateRecipeImageRecord(
                {
                    id: 7,
                    preparedObjectKey: 'authors/a/recipes/r/image.jpg',
                    fullSizeUrl: null,
                    smallUrl: null
                },
                { assetHost: 'https://images.om-recipes.com' }
            )
        ).toEqual(
            expect.objectContaining({
                assetUrls: {
                    320: 'https://images.om-recipes.com/320/authors/a/recipes/r/image.jpg',
                    640: 'https://images.om-recipes.com/640/authors/a/recipes/r/image.jpg',
                    960: 'https://images.om-recipes.com/960/authors/a/recipes/r/image.jpg',
                    1200: 'https://images.om-recipes.com/1200/authors/a/recipes/r/image.jpg',
                    1600: 'https://images.om-recipes.com/1600/authors/a/recipes/r/image.jpg',
                    original: 'https://images.om-recipes.com/original/authors/a/recipes/r/image.jpg'
                }
            })
        );
    });
});
