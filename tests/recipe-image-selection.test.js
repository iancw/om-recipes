import { describe, expect, it } from 'vitest';
import {
    comparisonImageSelectionValue,
    getAvailableComparisonImageLabels,
    getImagePreviewUrl,
    getRecipeCardPreviewUrl,
    getRecipeDownloadImage,
    getRecipeDownloadUrl,
    getRecipeModalImageUrl,
    getPrimarySampleImage,
    getRecipePreviewImage,
    getVisibleComparisonImages,
    getVisibleSampleImages,
    SAMPLE_IMAGE_SELECTION
} from '../lib/recipe-image-selection.js';

describe('recipe image selection helpers', () => {
    it('collects unique comparison labels across recipes', () => {
        const labels = getAvailableComparisonImageLabels([
            {
                comparisonImages: [
                    { id: 1, label: 'lighthouse' },
                    { id: 2, label: 'watch hill' }
                ]
            },
            {
                comparisonImages: [
                    { id: 3, label: 'Lighthouse' },
                    { id: 4, label: '  city  ' }
                ]
            }
        ]);

        expect(labels).toEqual(['city', 'lighthouse', 'watch hill']);
    });

    it('returns the primary sample image when sample is selected', () => {
        const recipe = {
            sampleImages: [{ id: 'sample-1' }, { id: 'sample-2', isPrimary: true }],
            comparisonImages: [{ id: 'comparison-1', label: 'lighthouse' }]
        };

        expect(getRecipePreviewImage(recipe, SAMPLE_IMAGE_SELECTION)).toEqual({ id: 'sample-2', isPrimary: true });
    });

    it('falls back to the first sample image when none are primary', () => {
        const recipe = {
            sampleImages: [{ id: 'sample-1' }, { id: 'sample-2' }]
        };

        expect(getPrimarySampleImage(recipe)).toEqual({ id: 'sample-1' });
    });

    it('falls back to a comparison image when no sample images are available', () => {
        const recipe = {
            id: 42,
            sampleImages: [],
            comparisonImages: [
                { id: 'comparison-1', label: 'lighthouse' },
                { id: 'comparison-2', label: 'watch hill' },
                { id: 'comparison-3', label: 'city' }
            ]
        };

        const picked = getPrimarySampleImage(recipe);
        expect(recipe.comparisonImages).toContainEqual(picked);
        // Selection must be stable for the same recipe.
        expect(getPrimarySampleImage(recipe)).toEqual(picked);
    });

    it('skips hidden comparison images when falling back', () => {
        const recipe = {
            id: 1,
            sampleImages: [],
            comparisonImages: [
                { id: 'comparison-hidden', label: 'lighthouse', copyright: false },
                { id: 'comparison-visible', label: 'watch hill' }
            ]
        };

        expect(getPrimarySampleImage(recipe)).toEqual({ id: 'comparison-visible', label: 'watch hill' });
    });

    it('returns null when neither sample nor comparison images are available', () => {
        expect(getPrimarySampleImage({ sampleImages: [], comparisonImages: [] })).toBeNull();
    });

    it('ignores hidden images when choosing visible samples and comparisons', () => {
        const recipe = {
            sampleImages: [
                { id: 'sample-hidden', isPrimary: true, copyright: false },
                { id: 'sample-visible' }
            ],
            comparisonImages: [
                { id: 'comparison-hidden', label: 'Lighthouse', copyright: false },
                { id: 'comparison-visible', label: 'Watch Hill' }
            ]
        };

        expect(getPrimarySampleImage(recipe)).toEqual({ id: 'sample-visible' });
        expect(getRecipePreviewImage(recipe, comparisonImageSelectionValue('lighthouse'))).toBeNull();
    });

    it('returns the matching comparison image by label', () => {
        const recipe = {
            sampleImages: [{ id: 'sample-1' }],
            comparisonImages: [
                { id: 'comparison-1', label: 'watch hill' },
                { id: 'comparison-2', label: 'Lighthouse' }
            ]
        };

        expect(
            getRecipePreviewImage(recipe, comparisonImageSelectionValue('lighthouse'))
        ).toEqual({ id: 'comparison-2', label: 'Lighthouse' });
    });

    it('returns null when the selected comparison label is missing', () => {
        const recipe = {
            sampleImages: [{ id: 'sample-1' }],
            comparisonImages: [{ id: 'comparison-1', label: 'watch hill' }]
        };

        expect(
            getRecipePreviewImage(recipe, comparisonImageSelectionValue('lighthouse'))
        ).toBeNull();
    });

    it('returns the first sample image with valid exif for downloads', () => {
        const recipe = {
            sampleImages: [
                { id: 'sample-1', validExif: false },
                { id: 'sample-2', validExif: true },
                { id: 'sample-3', validExif: true }
            ]
        };

        expect(getRecipeDownloadImage(recipe)).toEqual({ id: 'sample-2', validExif: true });
    });

    it('returns null when no sample image has valid exif', () => {
        const recipe = {
            sampleImages: [
                { id: 'sample-1', validExif: false },
                { id: 'sample-2' }
            ]
        };

        expect(getRecipeDownloadImage(recipe)).toBeNull();
    });

    it('prefers fixed asset renditions for preview, modal, and download contexts', () => {
        const recipe = {
            sampleImages: [
                {
                    id: 'sample-1',
                    validExif: true,
                    assetUrls: {
                        320: 'https://images.om-recipes.com/320/a.jpg',
                        640: 'https://images.om-recipes.com/640/a.jpg',
                        1200: 'https://images.om-recipes.com/1200/a.jpg',
                        1600: 'https://images.om-recipes.com/1600/a.jpg',
                        original: 'https://images.om-recipes.com/original/a.jpg'
                    },
                    smallUrl: '/assets/images/320/a.jpg',
                    fullSizeUrl: '/assets/images/original/a.jpg'
                }
            ]
        };

        expect(getRecipeCardPreviewUrl(recipe)).toBe('https://images.om-recipes.com/640/a.jpg');
        expect(getRecipeModalImageUrl(recipe.sampleImages[0])).toBe('https://images.om-recipes.com/1200/a.jpg');
        expect(getRecipeDownloadUrl(recipe)).toBe('https://images.om-recipes.com/original/a.jpg');
    });

    it('uses the 320 asset rendition when larger preview renditions are unavailable', () => {
        const recipe = {
            sampleImages: [
                {
                    id: 'sample-1',
                    assetUrls: {
                        320: 'https://images.om-recipes.com/320/a.jpg',
                        original: 'https://images.om-recipes.com/original/a.jpg'
                    }
                }
            ]
        };

        expect(getRecipeCardPreviewUrl(recipe)).toBe('https://images.om-recipes.com/320/a.jpg');
        expect(getImagePreviewUrl(recipe.sampleImages[0])).toBe('https://images.om-recipes.com/320/a.jpg');
    });

    it('falls back to legacy URLs when explicit asset renditions are missing', () => {
        const recipe = {
            sampleImages: [
                {
                    id: 'sample-1',
                    validExif: true,
                    smallUrl: '/assets/images/320/a.jpg',
                    fullSizeUrl: '/assets/images/original/a.jpg'
                }
            ]
        };

        expect(getRecipeCardPreviewUrl(recipe)).toBe('/assets/images/320/a.jpg');
        expect(getImagePreviewUrl(recipe.sampleImages[0])).toBe('/assets/images/320/a.jpg');
        expect(getRecipeModalImageUrl(recipe.sampleImages[0])).toBe('/assets/images/1200/a.jpg');
        expect(getRecipeDownloadUrl(recipe)).toBe('/assets/images/original/a.jpg');
    });

    it('uses the asset-host original for downloads when no legacy download URL remains', () => {
        const recipe = {
            sampleImages: [
                {
                    id: 'sample-1',
                    validExif: true,
                    assetUrls: {
                        original: 'https://images.om-recipes.com/original/a.jpg'
                    }
                }
            ]
        };

        expect(getRecipeDownloadUrl(recipe)).toBe('https://images.om-recipes.com/original/a.jpg');
    });

    it('lists visible sample images with the primary one first', () => {
        const recipe = {
            sampleImages: [
                { id: 'sample-1' },
                { id: 'sample-2', isPrimary: true },
                { id: 'sample-3' }
            ]
        };

        expect(getVisibleSampleImages(recipe)).toEqual([
            { id: 'sample-2', isPrimary: true },
            { id: 'sample-1' },
            { id: 'sample-3' }
        ]);
    });

    it('excludes hidden images from the visible sample list', () => {
        const recipe = {
            sampleImages: [
                { id: 'sample-hidden', isPrimary: true, copyright: false },
                { id: 'sample-visible-1' },
                { id: 'sample-visible-2' }
            ]
        };

        expect(getVisibleSampleImages(recipe)).toEqual([
            { id: 'sample-visible-1' },
            { id: 'sample-visible-2' }
        ]);
    });

    it('lists visible comparison images and excludes hidden ones', () => {
        const recipe = {
            comparisonImages: [
                { id: 'comparison-1', label: 'lighthouse' },
                { id: 'comparison-hidden', label: 'watch hill', copyright: false },
                { id: 'comparison-2', label: 'city' }
            ]
        };

        expect(getVisibleComparisonImages(recipe)).toEqual([
            { id: 'comparison-1', label: 'lighthouse' },
            { id: 'comparison-2', label: 'city' }
        ]);
    });

    it('returns no URLs for hidden images', () => {
        const hiddenImage = {
            id: 'sample-hidden',
            copyright: false,
            assetUrls: {
                640: 'https://images.om-recipes.com/640/a.jpg',
                1200: 'https://images.om-recipes.com/1200/a.jpg',
                original: 'https://images.om-recipes.com/original/a.jpg'
            },
            smallUrl: '/assets/images/320/a.jpg',
            fullSizeUrl: '/assets/images/original/a.jpg'
        };

        expect(getImagePreviewUrl(hiddenImage)).toBeNull();
        expect(getRecipeModalImageUrl(hiddenImage)).toBeNull();
    });
});
