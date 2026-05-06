import { describe, expect, it, vi } from 'vitest';

describe('link-public-sample-image helpers', () => {
    it('publishes the local file, upserts by object key, and inserts the sample link', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            verifiedObjects: 6
        });
        const findOrCreateObjectBackedImage = vi.fn().mockResolvedValue({
            image: { id: 44, prepared_object_key: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg' },
            created: true
        });
        const sql = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const { linkPublicSampleImage } = await import('../scripts/link-public-sample-image.mjs');
        const result = await linkPublicSampleImage({
            recipe: { id: 10, slug: 'portra-400', author_id: 5, author_uuid: 'author-uuid' },
            imagePath: { absolutePath: '/repo/public/images/A/B/lighthouse.jpg' },
            sql,
            publishManualImageAsset,
            findOrCreateObjectBackedImage
        });

        expect(result.imageRow.preparedObjectKey).toBe('authors/author-uuid/recipes/portra-400/lighthouse.jpg');
        expect(publishManualImageAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                absolutePath: '/repo/public/images/A/B/lighthouse.jpg',
                objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg'
            })
        );
        expect(findOrCreateObjectBackedImage).toHaveBeenCalledWith(sql, {
            authorId: 5,
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            dryRun: false
        });
        expect(sql).toHaveBeenCalledTimes(2);
        expect(sql.mock.calls[0].slice(1)).toEqual([10, 44]);
        expect(sql.mock.calls[1].slice(1)).toEqual([10, 44, 5]);
    });

    it('updates the sample link author when the link already exists with a different author', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            verifiedObjects: 6
        });
        const findOrCreateObjectBackedImage = vi.fn().mockResolvedValue({
            image: { id: 44, prepared_object_key: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg' },
            created: false
        });
        const sql = vi.fn().mockResolvedValueOnce([{ recipe_id: 10, image_id: 44, author_id: 7 }]).mockResolvedValueOnce([]);

        const { linkPublicSampleImage } = await import('../scripts/link-public-sample-image.mjs');
        await linkPublicSampleImage({
            recipe: { id: 10, slug: 'portra-400', author_id: 5, author_uuid: 'author-uuid' },
            imagePath: { absolutePath: '/repo/public/images/A/B/lighthouse.jpg' },
            sql,
            publishManualImageAsset,
            findOrCreateObjectBackedImage
        });

        expect(sql).toHaveBeenCalledTimes(2);
        expect(sql.mock.calls[1].slice(1)).toEqual([5, 10, 44]);
    });
});
