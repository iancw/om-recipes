import { describe, expect, it, vi } from 'vitest';

describe('upload-comparison-images helpers', () => {
    it('publishes comparison assets, upserts object-backed images, and inserts recipe links', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg',
            verifiedObjects: 6
        });
        const findOrCreateObjectBackedImage = vi.fn().mockResolvedValue({
            image: { id: 55, prepared_object_key: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg' },
            created: true
        });
        const sql = vi.fn().mockResolvedValueOnce([]);

        const { uploadComparisonImages } = await import('../scripts/upload-comparison-images.mjs');
        const result = await uploadComparisonImages({
            recipe: { id: 10, slug: 'portra-400', author_id: 5, author_uuid: 'author-uuid' },
            dirEntries: [{ absolutePath: '/repo/public/images/A/B/comparisons/watch hill.jpg', label: 'watch hill' }],
            sql,
            publishManualImageAsset,
            findOrCreateObjectBackedImage
        });

        expect(result.images[0]).toMatchObject({
            label: 'watch hill',
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg'
        });
        expect(publishManualImageAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                absolutePath: '/repo/public/images/A/B/comparisons/watch hill.jpg',
                objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg'
            })
        );
        expect(findOrCreateObjectBackedImage).toHaveBeenCalledWith(sql, {
            authorId: 5,
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg',
            dryRun: false
        });
        expect(sql).toHaveBeenCalledTimes(1);
        expect(sql.mock.calls[0].slice(1)).toEqual([10, 55, 'watch hill']);
    });

    it('does not mutate comparison links during dry run even when the image already exists', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg',
            verifiedObjects: 6
        });
        const findOrCreateObjectBackedImage = vi.fn().mockResolvedValue({
            image: { id: 55, prepared_object_key: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg' },
            created: false
        });
        const sql = vi.fn();

        const { uploadComparisonImages } = await import('../scripts/upload-comparison-images.mjs');
        const result = await uploadComparisonImages({
            recipe: { id: 10, slug: 'portra-400', author_id: 5, author_uuid: 'author-uuid' },
            dirEntries: [{ absolutePath: '/repo/public/images/A/B/comparisons/watch hill.jpg', label: 'watch hill' }],
            sql,
            dryRun: true,
            publishManualImageAsset,
            findOrCreateObjectBackedImage
        });

        expect(result.images[0]).toMatchObject({
            label: 'watch hill',
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg',
            imageId: 55
        });
        expect(publishManualImageAsset).not.toHaveBeenCalled();
        expect(findOrCreateObjectBackedImage).toHaveBeenCalledWith(sql, {
            authorId: 5,
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg',
            dryRun: true
        });
        expect(sql).not.toHaveBeenCalled();
    });
});
