import { describe, expect, it, vi } from 'vitest';

import { submitUploadSection } from '../app/upload/submit-upload-section.js';

describe('submitUploadSection', () => {
    it('creates the recipe from the first image and attaches the rest', async () => {
        const createdRecipe = { id: 77, slug: 'recipe-a', uuid: 'uuid-a' };
        const recipeIdentity = { slug: 'recipe-a', uuid: 'uuid-a' };
        const prepare = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                shouldCreateRecipe: true,
                imageId: 10,
                parUrl: 'https://upload/1',
                recipeId: createdRecipe.id,
                slug: createdRecipe.slug,
                recipeUuid: createdRecipe.uuid
            })
            .mockImplementationOnce(async ({ matchedRecipe }) => ({
                ok: true,
                shouldCreateRecipe: false,
                imageId: 11,
                parUrl: 'https://upload/2',
                matchedRecipe
            }));
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        const result = await submitUploadSection({
            section: {
                mode: 'create',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledTimes(2);
        expect(prepare).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                mode: 'attach',
                matchedRecipe: createdRecipe
            })
        );
        expect(result).toEqual({
            ok: true,
            createdRecipe: recipeIdentity,
            matchedRecipe: recipeIdentity,
            uploadedCount: 2,
            failedFile: null
            ,
            failedStage: null
        });
    });

    it('attaches every image when the section already matches an existing recipe', async () => {
        const matchedRecipe = { id: 77, slug: 'recipe-a', uuid: 'uuid-a', recipeName: 'Recipe A', authorName: 'Ian' };
        const prepare = vi.fn().mockImplementation(async ({ matchedRecipe: prepareMatchedRecipe }) => ({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: prepareMatchedRecipe
        }));
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe,
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                matchedRecipe
            })
        );
        expect(prepare).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                matchedRecipe
            })
        );
        expect(result).toEqual({
            ok: true,
            createdRecipe: null,
            matchedRecipe: { slug: 'recipe-a', uuid: 'uuid-a', recipeName: 'Recipe A', authorName: 'Ian' },
            uploadedCount: 2
            ,
            failedFile: null,
            failedStage: null
        });
    });

    it('stops the section on the first failed finalize and reports the failed file', async () => {
        const prepare = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 10, parUrl: 'https://upload/1', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } })
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 11, parUrl: 'https://upload/2', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi
            .fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, error: 'duplicate image' });

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 },
                    { name: 'third.jpg', type: 'image/jpeg', size: 30 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            ok: false,
            uploadedCount: 1,
            failedFile: 'second.jpg',
            failedStage: 'finalize'
        });
    });

    it('stops the section when direct upload resolves with ok false', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: false, error: 'PAR expired' });
        const finalize = vi.fn();

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(finalize).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            ok: false,
            uploadedCount: 0,
            failedFile: 'first.jpg',
            failedStage: 'direct-upload',
            error: 'PAR expired'
        });
    });

    it('preserves created recipe identity when the first created upload fails during finalize', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: true,
            imageId: 10,
            parUrl: 'https://upload/1',
            recipeId: 77,
            slug: 'recipe-a',
            recipeUuid: 'uuid-a'
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: false, error: 'duplicate image' });

        const result = await submitUploadSection({
            section: {
                mode: 'create',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(result).toEqual({
            ok: false,
            uploadedCount: 0,
            failedFile: 'first.jpg',
            failedStage: 'finalize',
            error: 'duplicate image',
            createdRecipe: { slug: 'recipe-a', uuid: 'uuid-a' },
            matchedRecipe: { slug: 'recipe-a', uuid: 'uuid-a' }
        });
    });

    it('propagates structured attach-target errors from prepare failures', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: false,
            error: 'Matched recipe was not found',
            errorCode: 'matched_recipe_not_found',
            status: 404
        });
        const directUpload = vi.fn();
        const finalize = vi.fn();

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: { slug: 'stale-recipe', uuid: 'stale-uuid', recipeName: 'Stale Recipe' },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(directUpload).not.toHaveBeenCalled();
        expect(finalize).not.toHaveBeenCalled();
        expect(result).toEqual({
            ok: false,
            uploadedCount: 0,
            failedFile: 'first.jpg',
            failedStage: 'prepare',
            error: 'Matched recipe was not found',
            errorCode: 'matched_recipe_not_found',
            status: 404,
            createdRecipe: null,
            matchedRecipe: { slug: 'stale-recipe', uuid: 'stale-uuid', recipeName: 'Stale Recipe' }
        });
    });

    it('prefers the canonical matched recipe returned from prepare when the first attach upload fails', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: {
                slug: 'canonical-recipe',
                uuid: 'shared-uuid',
                recipeName: 'Canonical Recipe',
                authorName: 'Ian'
            }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: false, error: 'PAR expired' });
        const finalize = vi.fn();

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: {
                    slug: 'stale-recipe',
                    uuid: 'shared-uuid',
                    recipeName: 'Stale Recipe'
                },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(finalize).not.toHaveBeenCalled();
        expect(result).toEqual({
            ok: false,
            uploadedCount: 0,
            failedFile: 'first.jpg',
            failedStage: 'direct-upload',
            error: 'PAR expired',
            createdRecipe: null,
            matchedRecipe: {
                slug: 'canonical-recipe',
                uuid: 'shared-uuid',
                recipeName: 'Canonical Recipe',
                authorName: 'Ian'
            }
        });
    });

    it('does not pass a skip-existing-match bypass to prepare', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: true,
            imageId: 10,
            parUrl: 'https://upload/1',
            recipeId: 77,
            slug: 'recipe-a',
            recipeUuid: 'uuid-a'
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        await submitUploadSection({
            section: {
                mode: 'create',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledWith(
            expect.not.objectContaining({
                skipExistingRecipeMatch: true
            })
        );
    });

    it('reports per-file upload progress while working through a section', async () => {
        const prepare = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                shouldCreateRecipe: true,
                imageId: 10,
                parUrl: 'https://upload/1',
                recipeId: 77,
                slug: 'recipe-a',
                recipeUuid: 'uuid-a'
            })
            .mockResolvedValueOnce({
                ok: true,
                shouldCreateRecipe: false,
                imageId: 11,
                parUrl: 'https://upload/2',
                matchedRecipe: { slug: 'recipe-a', uuid: 'uuid-a' }
            });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });
        const onProgress = vi.fn();

        await submitUploadSection({
            section: {
                mode: 'create',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 }
                ]
            },
            prepare,
            directUpload,
            finalize,
            onProgress
        });

        expect(onProgress).toHaveBeenNthCalledWith(1, {
            currentFileIndex: 1,
            totalFiles: 2,
            fileName: 'first.jpg'
        });
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            currentFileIndex: 2,
            totalFiles: 2,
            fileName: 'second.jpg'
        });
    });

    it('passes each file\'s cameraMetadata through to prepare', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });
        const cameraMetadata = {
            camera: 'OM-3',
            lens: 'OLYMPUS M.17mm F1.8',
            shutterSpeed: '1/800',
            aperture: '8.0',
            focalLength: '17.0 mm',
            iso: '320'
        };
        const file = { name: 'first.jpg', type: 'image/jpeg', size: 10, cameraMetadata };

        await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [file]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledWith(
            expect.objectContaining({ cameraMetadata })
        );
    });

    it('passes cameraMetadata as null when the file has none', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });
        const file = { name: 'first.jpg', type: 'image/jpeg', size: 10 };

        await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [file]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledWith(
            expect.objectContaining({ cameraMetadata: null })
        );
    });
});
