import { describe, expect, it, vi } from 'vitest';

describe('migrate-image-bucket helpers', () => {
    it('parses explicit object-name arguments and reports expected single-bucket objects', async () => {
        const { parseArgs, expectedMigrationObjectNames } = await import('../scripts/migrate-image-bucket.mjs');

        expect(
            parseArgs([
                '--object-name',
                'authors/a/recipes/r/one.jpg',
                '--object-name',
                'authors/a/recipes/r/two.jpg'
            ])
        ).toEqual({
            objectNames: ['authors/a/recipes/r/one.jpg', 'authors/a/recipes/r/two.jpg'],
            dryRun: false
        });

        expect(expectedMigrationObjectNames('authors/a/recipes/r/image.jpg')).toEqual([
            'authors/a/recipes/r/image.jpg',
            '320/authors/a/recipes/r/image.jpg',
            '640/authors/a/recipes/r/image.jpg',
            '960/authors/a/recipes/r/image.jpg',
            '1200/authors/a/recipes/r/image.jpg',
            '1600/authors/a/recipes/r/image.jpg'
        ]);
    });

    it('builds one batch invoke from an explicit object-key list and verifies originals plus variants', async () => {
        const invokeImageResizeFunction = vi.fn().mockResolvedValue({
            ok: true,
            processed: 2,
            succeeded: 2,
            failed: 0,
            results: [
                {
                    objectName: 'authors/a/recipes/r/one.jpg',
                    ok: true,
                    copiedOriginalObject: 'authors/a/recipes/r/one.jpg',
                    variantObjects: [
                        '320/authors/a/recipes/r/one.jpg',
                        '640/authors/a/recipes/r/one.jpg',
                        '960/authors/a/recipes/r/one.jpg',
                        '1200/authors/a/recipes/r/one.jpg',
                        '1600/authors/a/recipes/r/one.jpg'
                    ]
                },
                {
                    objectName: 'authors/a/recipes/r/two.jpg',
                    ok: true,
                    copiedOriginalObject: 'authors/a/recipes/r/two.jpg',
                    variantObjects: [
                        '320/authors/a/recipes/r/two.jpg',
                        '640/authors/a/recipes/r/two.jpg',
                        '960/authors/a/recipes/r/two.jpg',
                        '1200/authors/a/recipes/r/two.jpg',
                        '1600/authors/a/recipes/r/two.jpg'
                    ]
                }
            ]
        });
        const headObject = vi.fn().mockResolvedValue({});

        const { migrateImageBucket } = await import('../scripts/migrate-image-bucket.mjs');
        const summary = await migrateImageBucket({
            objectNames: ['authors/a/recipes/r/one.jpg', 'authors/a/recipes/r/two.jpg'],
            dryRun: false,
            sourceBucket: 'originals',
            destinationBucket: 'images',
            namespaceName: 'ns',
            storageClient: {},
            invokeImageResizeFunction,
            headObject
        });

        expect(summary).toEqual({
            processed: 2,
            succeeded: 2,
            failed: 0,
            verified: 12,
            dryRun: false
        });
        expect(invokeImageResizeFunction).toHaveBeenCalledWith({
            sourceBucket: 'originals',
            objectNames: ['authors/a/recipes/r/one.jpg', 'authors/a/recipes/r/two.jpg'],
            destinationBucket: 'images'
        });
        expect(headObject).toHaveBeenCalledTimes(12);
        expect(headObject).toHaveBeenCalledWith({
            client: {},
            namespaceName: 'ns',
            bucketName: 'images',
            objectName: '1600/authors/a/recipes/r/two.jpg'
        });
    });
});
