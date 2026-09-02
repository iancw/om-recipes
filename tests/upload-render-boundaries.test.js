import { describe, expect, it } from 'vitest';

import {
    runExclusiveExifBatch,
    shouldApplyUploadRequestResult
} from '../app/upload/RecipeUpload.jsx';
import {
    buildSuccessRecipeLink,
    buildUploadProgressSummary,
    buildSuccessSummary,
    buildRetryAttachState,
    buildMatchCheckFailureState,
    buildBlockingMatchMessage,
    getSectionFieldValidation,
    resolveSectionMatchState,
    shouldShowSectionForm,
    trimUploadedFilesAfterFailure
} from '../app/upload/RecipeUploadSection.jsx';
import {
    areDetectedRecipeSettingsPropsEqual,
    areSectionFormPropsEqual,
    areSectionPreviewPropsEqual,
    buildSectionRenderKey
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

    it('ignores section form edits when preview props are unchanged', () => {
        const previewProps = {
            fileNames: ['one.jpg', 'two.jpg'],
            previewUrls: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'],
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
            blockingRecipe: null,
            blockingMatchLevel: null,
            mode: null,
            matchState: 'error',
            matchError: 'network down'
        });
    });

    it('resolves exact matches into attach mode', () => {
        expect(
            resolveSectionMatchState({
                full: {
                    slug: 'exact-recipe',
                    recipeName: 'Exact Recipe'
                },
                noWb: {
                    slug: 'close-recipe',
                    recipeName: 'Close Recipe'
                }
            })
        ).toEqual({
            matchedRecipe: {
                slug: 'exact-recipe',
                recipeName: 'Exact Recipe'
            },
            blockingRecipe: null,
            blockingMatchLevel: null,
            mode: 'attach'
        });
    });

    it('blocks create mode when a no-WB partial match exists without an exact match', () => {
        expect(
            resolveSectionMatchState({
                full: null,
                noWb: {
                    slug: 'near-duplicate',
                    recipeName: 'Near Duplicate'
                },
                colorTone: {
                    slug: 'weaker-match',
                    recipeName: 'Weaker Match'
                }
            })
        ).toEqual({
            matchedRecipe: null,
            blockingRecipe: {
                slug: 'near-duplicate',
                recipeName: 'Near Duplicate'
            },
            blockingMatchLevel: 'noWb',
            mode: 'blocked'
        });
    });

    it('allows create mode when there is no exact or partial fingerprint match', () => {
        expect(
            resolveSectionMatchState({
                full: null,
                noWb: null,
                colorTone: null,
                color: null
            })
        ).toEqual({
            matchedRecipe: null,
            blockingRecipe: null,
            blockingMatchLevel: null,
            mode: 'create'
        });
    });

    it('describes the strongest partial match when blocking upload creation', () => {
        expect(
            buildBlockingMatchMessage({
                blockingRecipe: {
                    recipeName: 'Existing Recipe',
                    authorName: 'Existing Author'
                },
                blockingMatchLevel: 'noWb'
            })
        ).toBe('Too close to an existing recipe. "Existing Recipe" by Existing Author already matches these settings except for white balance. Uploading a new recipe is disabled for this section.');
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

    it('hides the section form after a successful upload', () => {
        expect(shouldShowSectionForm('idle', 'create')).toBe(true);
        expect(shouldShowSectionForm('uploading', 'create')).toBe(true);
        expect(shouldShowSectionForm('error', 'create')).toBe(true);
        expect(shouldShowSectionForm('ok', 'create')).toBe(false);
    });

    it('hides the section form when upload creation is blocked by a partial match', () => {
        expect(shouldShowSectionForm('idle', 'blocked')).toBe(false);
    });

    it('builds a created recipe link from the authoritative success result', () => {
        expect(
            buildSuccessRecipeLink({
                result: {
                    createdRecipe: {
                        slug: 'new-recipe',
                        uuid: 'recipe-uuid-4',
                        recipeName: 'New Recipe'
                    }
                },
                matchedRecipe: null
            })
        ).toEqual({
            href: '/recipes/new-recipe',
            label: 'View recipe'
        });
    });

    it('builds upload progress summaries with file counts for multi-image uploads', () => {
        expect(
            buildUploadProgressSummary({
                currentFileIndex: 2,
                totalFiles: 5,
                fileName: 'second.jpg'
            })
        ).toBe('Uploading image 2 of 5: second.jpg');
        expect(
            buildUploadProgressSummary({
                currentFileIndex: 1,
                totalFiles: 1,
                fileName: 'only.jpg'
            })
        ).toBe('Uploading image: only.jpg');
    });
});
