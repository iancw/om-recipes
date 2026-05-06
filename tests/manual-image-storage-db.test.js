import { describe, expect, it, vi } from 'vitest';

describe('manual image publish helpers', () => {
    it('uploads the original, invokes renditions, verifies expected objects, and returns the canonical key', async () => {
        const putObjectFromFile = vi.fn().mockResolvedValue({});
        const invokeImageResizeFunction = vi.fn().mockResolvedValue({ ok: true });
        const headObject = vi.fn().mockResolvedValue({});

        const { publishManualImageAsset } = await import('../scripts/manual-image-storage.mjs');
        const result = await publishManualImageAsset({
            absolutePath: '/tmp/lighthouse.jpg',
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            originalBucket: 'originals',
            processedBucket: 'processed',
            namespaceName: 'ns',
            storageClient: {},
            putObjectFromFile,
            invokeImageResizeFunction,
            headObject
        });

        expect(result).toEqual({
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            verifiedObjects: 6
        });
        expect(putObjectFromFile).toHaveBeenCalledWith(
            expect.objectContaining({
                bucketName: 'originals',
                objectName: 'authors/a/recipes/r/lighthouse.jpg',
                filePath: '/tmp/lighthouse.jpg',
                contentType: 'image/jpeg'
            })
        );
        expect(invokeImageResizeFunction).toHaveBeenCalledWith({
            sourceBucket: 'originals',
            objectName: 'authors/a/recipes/r/lighthouse.jpg',
            destinationBucket: 'processed'
        });
        expect(headObject).toHaveBeenCalledTimes(6);
        expect(headObject.mock.calls[0][0]).toEqual({
            client: {},
            namespaceName: 'ns',
            bucketName: 'originals',
            objectName: 'authors/a/recipes/r/lighthouse.jpg'
        });
        expect(headObject.mock.calls.slice(1).map(([args]) => args.bucketName)).toEqual([
            'processed',
            'processed',
            'processed',
            'processed',
            'processed'
        ]);
        expect(headObject.mock.calls.slice(1).map(([args]) => args.objectName)).toEqual([
            '320/authors/a/recipes/r/lighthouse.jpg',
            '640/authors/a/recipes/r/lighthouse.jpg',
            '960/authors/a/recipes/r/lighthouse.jpg',
            '1200/authors/a/recipes/r/lighthouse.jpg',
            '1600/authors/a/recipes/r/lighthouse.jpg'
        ]);
    });

    it('returns an existing image row without inserting', async () => {
        const sql = vi.fn().mockResolvedValueOnce([
            { id: 44, prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg' }
        ]);

        const { findOrCreateObjectBackedImage } = await import('../scripts/manual-image-storage.mjs');
        const result = await findOrCreateObjectBackedImage(sql, {
            authorId: 12,
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            dryRun: false
        });

        expect(result).toEqual({
            image: { id: 44, prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg' },
            created: false
        });
        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('reuses an existing object-backed row even when it belongs to another author', async () => {
        const sql = vi.fn((strings, ...values) => {
            const query = strings.join(' ');

            expect(query).not.toContain('author_id =');
            expect(values).toEqual(['authors/a/recipes/r/lighthouse.jpg']);

            return Promise.resolve([
                {
                    id: 44,
                    author_id: 19,
                    prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg'
                }
            ]);
        });

        const { findOrCreateObjectBackedImage } = await import('../scripts/manual-image-storage.mjs');
        const result = await findOrCreateObjectBackedImage(sql, {
            authorId: 12,
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            dryRun: false
        });

        expect(result).toEqual({
            image: {
                id: 44,
                author_id: 19,
                prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg'
            },
            created: false
        });
        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('returns a synthetic row during dry run without inserting', async () => {
        const sql = vi.fn().mockResolvedValueOnce([]);

        const { findOrCreateObjectBackedImage } = await import('../scripts/manual-image-storage.mjs');
        const result = await findOrCreateObjectBackedImage(sql, {
            authorId: 12,
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            dryRun: true
        });

        expect(result).toEqual({
            image: {
                id: null,
                prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg',
                author_id: 12
            },
            created: true
        });
        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('upserts an image row using prepared_object_key as the canonical identifier', async () => {
        const sql = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 77, prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg' }]);

        const { findOrCreateObjectBackedImage } = await import('../scripts/manual-image-storage.mjs');
        const result = await findOrCreateObjectBackedImage(sql, {
            authorId: 12,
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            dryRun: false
        });

        expect(result.image.id).toBe(77);
        expect(result.created).toBe(true);
        expect(result.image.prepared_object_key).toBe('authors/a/recipes/r/lighthouse.jpg');
        expect(sql).toHaveBeenCalledTimes(2);
    });

    it('returns the existing row when insert races the global prepared_object_key uniqueness constraint', async () => {
        const sql = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 88,
                    author_id: 19,
                    prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg'
                }
            ]);

        const { findOrCreateObjectBackedImage } = await import('../scripts/manual-image-storage.mjs');
        const result = await findOrCreateObjectBackedImage(sql, {
            authorId: 12,
            objectKey: 'authors/a/recipes/r/lighthouse.jpg',
            dryRun: false
        });

        expect(result).toEqual({
            image: {
                id: 88,
                author_id: 19,
                prepared_object_key: 'authors/a/recipes/r/lighthouse.jpg'
            },
            created: false
        });
        expect(sql).toHaveBeenCalledTimes(3);
        expect(sql.mock.calls[1][0].join(' ')).toContain('ON CONFLICT DO NOTHING');
    });
});
