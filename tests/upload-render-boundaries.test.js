import { describe, expect, it } from 'vitest';

import {
    runExclusiveExifBatch,
    shouldApplyUploadRequestResult
} from '../app/upload/RecipeUpload.jsx';
import {
    buildSuccessSummary,
    buildRetryAttachState,
    buildMatchCheckFailureState,
    getSectionFieldValidation,
    getVisiblePreviewUrls,
    trimUploadedFilesAfterFailure
} from '../app/upload/RecipeUploadSection.jsx';
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

    it('keeps the section blocked when the exact-match lookup rejects', () => {
        expect(
            buildMatchCheckFailureState(new Error('network down'))
        ).toEqual({
            matchedRecipe: null,
            mode: null,
            matchState: 'error',
            matchError: 'network down'
        });
    });

    it('trims already uploaded files after a partial section failure', () => {
        const files = [
            { name: 'first.jpg' },
            { name: 'second.jpg' },
            { name: 'third.jpg' }
        ];

        expect(trimUploadedFilesAfterFailure(files, 1)).toEqual([
            { name: 'second.jpg' },
            { name: 'third.jpg' }
        ]);
        expect(trimUploadedFilesAfterFailure(files, 0)).toEqual(files);
        expect(trimUploadedFilesAfterFailure(files, 99)).toEqual([]);
    });

    it('switches failed create uploads into attach context when the failure returns recipe identity', () => {
        expect(
            buildRetryAttachState({
                result: {
                    createdRecipe: { slug: 'new-recipe', uuid: 'recipe-uuid-1' },
                    matchedRecipe: { slug: 'new-recipe', uuid: 'recipe-uuid-1' }
                },
                matchedRecipe: null,
                mode: 'create'
            })
        ).toEqual({
            matchedRecipe: { slug: 'new-recipe', uuid: 'recipe-uuid-1' },
            mode: 'attach'
        });
    });

    it('preserves existing match metadata when a failed retry returns attach identity', () => {
        expect(
            buildRetryAttachState({
                result: {
                    matchedRecipe: { slug: 'existing-recipe', uuid: 'recipe-uuid-2' }
                },
                matchedRecipe: {
                    slug: 'existing-recipe',
                    uuid: 'recipe-uuid-2',
                    recipeName: 'Existing Recipe',
                    authorName: 'Existing Author'
                },
                mode: 'create'
            })
        ).toEqual({
            matchedRecipe: {
                slug: 'existing-recipe',
                uuid: 'recipe-uuid-2',
                recipeName: 'Existing Recipe',
                authorName: 'Existing Author'
            },
            mode: 'attach'
        });
    });

    it('clears stale attach context when the server reports the matched recipe was not found', () => {
        expect(
            buildRetryAttachState({
                result: {
                    error: 'Matched recipe was not found',
                    errorCode: 'matched_recipe_not_found',
                    status: 404
                },
                matchedRecipe: {
                    slug: 'stale-recipe',
                    uuid: 'stale-uuid',
                    recipeName: 'Stale Recipe'
                },
                mode: 'attach'
            })
        ).toEqual({
            matchedRecipe: null,
            mode: 'create'
        });
    });

    it('clears stale attach context when the server reports an attach fingerprint mismatch', () => {
        expect(
            buildRetryAttachState({
                result: {
                    error: 'Matched recipe does not match the uploaded recipe settings',
                    errorCode: 'matched_recipe_fingerprint_mismatch',
                    status: 409
                },
                matchedRecipe: {
                    slug: 'stale-recipe',
                    uuid: 'stale-uuid',
                    recipeName: 'Stale Recipe'
                },
                mode: 'attach'
            })
        ).toEqual({
            matchedRecipe: null,
            mode: 'create'
        });
    });

    it('builds attach success summaries from authoritative result match data before stale local state', () => {
        expect(
            buildSuccessSummary({
                result: {
                    uploadedCount: 2,
                    matchedRecipe: {
                        slug: 'authoritative-recipe',
                        uuid: 'recipe-uuid-3',
                        recipeName: 'Authoritative Recipe'
                    }
                },
                matchedRecipe: {
                    slug: 'stale-recipe',
                    uuid: 'recipe-uuid-stale',
                    recipeName: 'Stale Recipe'
                },
                recipeName: 'Ignored'
            })
        ).toBe('Attached 2 images to "Authoritative Recipe".');
    });

    it('hides stale preview URLs immediately when a retry trims the pending file batch', () => {
        expect(
            getVisiblePreviewUrls({
                previewUrls: ['blob:first', 'blob:second'],
                resolvedPreviewBatchKey: 'first.jpg:1:1|second.jpg:2:2',
                previewBatchKey: 'second.jpg:2:2'
            })
        ).toEqual([]);
    });

    it('drops create-only browser validation requirements in attach mode', () => {
        expect(getSectionFieldValidation('attach')).toEqual({
            nameRequired: false,
            sourceUrlInputType: 'text'
        });
        expect(getSectionFieldValidation('create')).toEqual({
            nameRequired: true,
            sourceUrlInputType: 'url'
        });
    });
});
