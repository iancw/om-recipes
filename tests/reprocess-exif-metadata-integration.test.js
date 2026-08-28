import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';
import { RECIPE_EXIFTOOL_ARGS, parseCameraMetadataFromExif } from '../lib/exifparse.js';
import { cachePaths, ensureCacheDirs, readRawCache } from '../lib/exif-reprocess-cache.js';
import { fetchExifText } from '../scripts/reprocess-exif-metadata.mjs';

afterAll(async () => {
    await disposeExifTool().catch(() => {});
});

describe('fetchExifText against the real exiftool binary', () => {
    let base;
    let paths;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), 'exif-integration-'));
        paths = cachePaths(base);
        await ensureCacheDirs(paths);
    });

    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    it('downloads (faked), parses with production args, and caches real exif text', async () => {
        const bytes = readFileSync('data/samples/OM_recipe_3.jpg');
        const image = { id: 1, uuid: 'sample-3', preparedObjectKey: 'authors/a/recipes/r/sample-3.jpg' };

        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: {
                getObject: async () => ({ value: bytes }),
                readBody: async (r) => r.value,
                parseMetadata,
                storageClient: {}, namespaceName: 'ns', bucketName: 'orig',
                exiftoolArgs: RECIPE_EXIFTOOL_ARGS
            }
        });

        expect(result.status).toBe('ok');
        expect(result.raw).toMatch(/Camera Model Name/);

        const camera = parseCameraMetadataFromExif(result.raw);
        expect(camera.camera).not.toBeNull();
        expect(camera.lens).not.toBeNull();

        expect(await readRawCache(paths, 'sample-3')).toBe(result.raw);
    });
});
