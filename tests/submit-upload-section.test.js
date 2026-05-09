import { describe, expect, it, vi } from 'vitest';

import { submitUploadSection } from '../app/upload/submit-upload-section.js';

describe('submitUploadSection', () => {
    it('creates the recipe from the first image and attaches the rest', async () => {
        const prepare = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: true, imageId: 10, parUrl: 'https://upload/1', slug: 'recipe-a', recipeUuid: 'uuid-a' })
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 11, parUrl: 'https://upload/2', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } });
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
        expect(result).toMatchObject({
            ok: true,
            createdRecipe: { slug: 'recipe-a', uuid: 'uuid-a' },
            uploadedCount: 2,
            failedFile: null
        });
    });

    it('attaches every image when the section already matches an existing recipe', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
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

        expect(result).toMatchObject({
            ok: true,
            matchedRecipe: { slug: 'recipe-a', uuid: 'uuid-a' },
            uploadedCount: 2
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
});
