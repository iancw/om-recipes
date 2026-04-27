import { describe, expect, it } from 'vitest';

import {
    areDetectedRecipeSettingsPropsEqual,
    areUploadPreviewPropsEqual
} from '../app/upload/render-boundaries.js';

describe('upload render boundaries', () => {
    it('treats the same parsed recipe object as unchanged for detected settings', () => {
        const recipe = { yellow: 1, blue: -1 };

        expect(
            areDetectedRecipeSettingsPropsEqual(
                { recipe },
                { recipe }
            )
        ).toBe(true);
    });

    it('rerenders detected settings when the parsed recipe object changes', () => {
        expect(
            areDetectedRecipeSettingsPropsEqual(
                { recipe: { yellow: 1, blue: -1 } },
                { recipe: { yellow: 1, blue: -1 } }
            )
        ).toBe(false);
    });

    it('treats title and notes edits as irrelevant to the preview thumbnail subtree', () => {
        const onRemoveImage = () => {};
        const props = {
            fileName: 'recipe.jpg',
            previewUrl: 'blob:preview',
            disablePreview: false,
            isPreparingPreview: false,
            onRemoveImage
        };

        expect(
            areUploadPreviewPropsEqual(props, {
                ...props,
                name: 'New Title',
                notes: 'Fresh notes'
            })
        ).toBe(true);
    });

    it('rerenders the preview thumbnail when the image preview state changes', () => {
        const onRemoveImage = () => {};

        expect(
            areUploadPreviewPropsEqual(
                {
                    fileName: 'recipe.jpg',
                    previewUrl: 'blob:preview-a',
                    disablePreview: false,
                    isPreparingPreview: false,
                    onRemoveImage
                },
                {
                    fileName: 'recipe.jpg',
                    previewUrl: 'blob:preview-b',
                    disablePreview: false,
                    isPreparingPreview: false,
                    onRemoveImage
                }
            )
        ).toBe(false);
    });
});
