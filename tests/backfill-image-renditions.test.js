import { describe, expect, it, vi } from 'vitest';

describe('backfill-image-renditions helpers', () => {
    it('parses resumable backfill arguments and reports expected fixed variants', async () => {
        const { parseArgs, expectedVariantObjectNames } = await import('../scripts/backfill-image-renditions.mjs');

        expect(parseArgs(['--after-id', '25'])).toEqual({
            afterId: 25,
            limit: null,
            dryRun: false
        });

        expect(expectedVariantObjectNames('authors/a/recipes/r/image.jpg')).toEqual([
            '320/authors/a/recipes/r/image.jpg',
            '640/authors/a/recipes/r/image.jpg',
            '960/authors/a/recipes/r/image.jpg',
            '1200/authors/a/recipes/r/image.jpg',
            '1600/authors/a/recipes/r/image.jpg'
        ]);
    });

    it('iterates finalized rows after the resume cursor and verifies every expected variant', async () => {
        const rows = [
            { id: 26, prepared_object_key: 'authors/a/recipes/r/one.jpg' },
            { id: 27, prepared_object_key: 'authors/a/recipes/r/two.jpg' }
        ];
        const invokeImageResizeFunction = vi.fn().mockResolvedValue({ ok: true });
        const headObject = vi.fn().mockResolvedValue({});

        const { backfillImageRenditions } = await import('../scripts/backfill-image-renditions.mjs');
        const summary = await backfillImageRenditions({
            rows,
            dryRun: false,
            originalBucket: 'originals',
            resizedBucket: 'processed',
            namespaceName: 'ns',
            storageClient: {},
            invokeImageResizeFunction,
            headObject
        });

        expect(summary).toEqual({
            processed: 2,
            verified: 10,
            lastProcessedId: 27,
            dryRun: false
        });
        expect(invokeImageResizeFunction).toHaveBeenNthCalledWith(1, {
            sourceBucket: 'originals',
            objectName: 'authors/a/recipes/r/one.jpg',
            destinationBucket: 'processed'
        });
        expect(invokeImageResizeFunction).toHaveBeenNthCalledWith(2, {
            sourceBucket: 'originals',
            objectName: 'authors/a/recipes/r/two.jpg',
            destinationBucket: 'processed'
        });
        expect(headObject).toHaveBeenCalledTimes(10);
        expect(headObject).toHaveBeenCalledWith({
            client: {},
            namespaceName: 'ns',
            bucketName: 'processed',
            objectName: '1600/authors/a/recipes/r/two.jpg'
        });
    });
});
