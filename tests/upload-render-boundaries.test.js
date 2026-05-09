import { describe, expect, it } from 'vitest';

import {
    runExclusiveExifBatch,
    shouldApplyUploadRequestResult
} from '../app/upload/RecipeUpload.jsx';
import {
    areDetectedRecipeSettingsPropsEqual,
    areSectionFormPropsEqual,
    areSectionPreviewPropsEqual,
    buildSectionRenderKey,
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

    it('ignores section form edits when preview props are unchanged', () => {
        const previewProps = {
            fileNames: ['one.jpg', 'two.jpg'],
            previewUrls: ['blob:1', 'blob:2'],
            disablePreview: false,
            isPreparingPreview: false,
            recipeId: 'section-fp-1'
        };

        expect(
            areSectionPreviewPropsEqual(previewProps, {
                ...previewProps,
                author: 'New Author',
                name: 'New Recipe Name',
                notes: 'New Notes'
            })
        ).toBe(true);
    });

    it('rerenders the section form subtree when section metadata changes', () => {
        expect(
            areSectionFormPropsEqual(
                { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '', submitState: 'idle' },
                { author: 'Ian', name: 'Recipe B', notes: '', sourceUrl: '', submitState: 'idle' }
            )
        ).toBe(false);
    });

    it('keeps the section render key stable within a batch and changes it across batches', () => {
        expect(buildSectionRenderKey(2, 'section-fp-1')).toBe(buildSectionRenderKey(2, 'section-fp-1'));
        expect(buildSectionRenderKey(2, 'section-fp-1')).not.toBe(buildSectionRenderKey(3, 'section-fp-1'));
        expect(buildSectionRenderKey(2, 'section-fp-1')).not.toBe(buildSectionRenderKey(2, 'section-fp-2'));
        expect(buildSectionRenderKey(2, 'section-fp-1')).toBe('2:section-fp-1');
    });

    it('serializes EXIF batch work so one drop batch cannot dispose the tool under another', async () => {
        const events = [];
        let releaseFirstBatch;

        const firstBatch = runExclusiveExifBatch(async () => {
            events.push('first:start');
            await new Promise((resolve) => {
                releaseFirstBatch = resolve;
            });
            events.push('first:end');
            return 'first';
        });

        const secondBatch = runExclusiveExifBatch(async () => {
            events.push('second:start');
            events.push('second:end');
            return 'second';
        });

        await Promise.resolve();
        expect(events).toEqual(['first:start']);

        releaseFirstBatch();

        await expect(firstBatch).resolves.toBe('first');
        await expect(secondBatch).resolves.toBe('second');
        expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    });

    it('only applies upload state updates for the latest drop request', () => {
        expect(shouldApplyUploadRequestResult(4, 4)).toBe(true);
        expect(shouldApplyUploadRequestResult(5, 4)).toBe(false);
    });
});
