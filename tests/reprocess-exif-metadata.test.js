import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile as readFileFs } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    appendProgress,
    cachePaths,
    ensureCacheDirs,
    readRawCache,
    writeRawCache
} from '../lib/exif-reprocess-cache.js';
import {
    applyImageUpdates,
    applyRecipeUpdates,
    fetchExifText,
    formatSummary,
    parseArgs,
    run,
    selectImages,
    selectSampleImageRows
} from '../scripts/reprocess-exif-metadata.mjs';
import { computeRecipeFingerprint } from '../lib/recipeFingerprint.js';
import { parseRecipeSettingsFromExif } from '../lib/exifparse.js';

const RUN_RAW = readFileSync(
    new URL('../openspec/changes/monochrome-profiles/sample-exif/P4070386.JPG.txt', import.meta.url),
    'utf8'
);

// Mimics the drizzle update builder closely enough for the appliers: the
// object returned by .where() is awaitable AND exposes .returning().
function makeUpdater({ calls, returningFor = () => [{ recipeId: 1 }], shouldFail = () => false }) {
    return (table) => ({
        set(values) {
            return {
                where(cond) {
                    const call = { table, values, cond };
                    calls.push(call);
                    const execute = () => (shouldFail(call)
                        ? Promise.reject(new Error('db write failed'))
                        : Promise.resolve(returningFor(call)));
                    return {
                        returning: () => execute(),
                        then: (resolve, reject) => execute().then(resolve, reject)
                    };
                }
            };
        }
    });
}

function fakeDb(options = {}) {
    const calls = [];
    return { calls, update: makeUpdater({ calls, ...options }) };
}

const schema = {
    images: { __name: 'images', id: { name: 'id' } },
    recipes: { __name: 'recipes', id: { name: 'id' } },
    recipeColorSettings: { __name: 'recipe_color_settings', recipeId: { name: 'recipe_id' } },
    recipeMonoSettings: { __name: 'recipe_mono_settings', recipeId: { name: 'recipe_id' } }
};

describe('applyImageUpdates', () => {
    const updates = [{
        imageId: 7, uuid: 'u7',
        after: { camera: 'OM-3', lens: 'L', shutterSpeed: '1/800', aperture: '8.0', focalLength: '17.0 mm', iso: '320' }
    }];

    it('writes nothing on a dry run', async () => {
        const db = fakeDb();
        const result = await applyImageUpdates(db, schema, updates, { apply: false });
        expect(result).toEqual({ written: 0, failures: [] });
        expect(db.calls).toEqual([]);
    });

    it('updates the images row when applying', async () => {
        const db = fakeDb();
        const result = await applyImageUpdates(db, schema, updates, { apply: true });
        expect(result).toEqual({ written: 1, failures: [] });
        expect(db.calls).toHaveLength(1);
        expect(db.calls[0].table).toBe(schema.images);
        expect(db.calls[0].values).toEqual(updates[0].after);
    });

    it('isolates a failing row: later rows still write and the failure carries the id', async () => {
        const db = fakeDb({ shouldFail: (call) => call.values.camera === 'BOOM' });
        const result = await applyImageUpdates(db, schema, [
            { imageId: 7, uuid: 'u7', after: { camera: 'BOOM' } },
            { imageId: 8, uuid: 'u8', after: { camera: 'OM-3' } },
            { imageId: 9, uuid: 'u9', after: { camera: 'OM-1' } }
        ], { apply: true });

        expect(result.written).toBe(2);
        expect(result.failures).toEqual([
            { kind: 'write', entity: 'image', id: 7, error: 'db write failed' }
        ]);
        expect(db.calls).toHaveLength(3);
    });
});

describe('applyRecipeUpdates', () => {
    it('writes the mirror and the color settings table for a COLOR recipe', async () => {
        const db = fakeDb();
        const updates = [{ recipeId: 3, slug: 's', type: 'COLOR', after: { shadingEffect: 2, exposureCompensation: -3 } }];
        const result = await applyRecipeUpdates(db, schema, updates, { apply: true });
        expect(result).toEqual({ written: 1, failures: [] });
        const tables = db.calls.map((c) => c.table);
        expect(tables).toContain(schema.recipes);
        expect(tables).toContain(schema.recipeColorSettings);
        expect(tables).not.toContain(schema.recipeMonoSettings);
        for (const call of db.calls) {
            expect(call.values).toMatchObject({ shadingEffect: 2, exposureCompensation: -3 });
        }
    });

    it('writes the settings table before the legacy recipes mirror', async () => {
        const db = fakeDb();
        await applyRecipeUpdates(
            db, schema,
            [{ recipeId: 3, slug: 's', type: 'COLOR', after: { shadingEffect: 2, exposureCompensation: -3 } }],
            { apply: true }
        );
        expect(db.calls.map((c) => c.table)).toEqual([schema.recipeColorSettings, schema.recipes]);
    });

    it('writes the mono settings table for a MONO recipe', async () => {
        const db = fakeDb();
        const updates = [{ recipeId: 4, slug: 's2', type: 'MONO', after: { shadingEffect: 0, exposureCompensation: 5 } }];
        await applyRecipeUpdates(db, schema, updates, { apply: true });
        expect(db.calls.map((c) => c.table)).toContain(schema.recipeMonoSettings);
    });

    it('writes nothing on a dry run', async () => {
        const db = fakeDb();
        const result = await applyRecipeUpdates(db, schema, [{ recipeId: 4, type: 'MONO', after: { shadingEffect: 0, exposureCompensation: 0 } }], { apply: false });
        expect(result).toEqual({ written: 0, failures: [] });
        expect(db.calls).toEqual([]);
    });

    it('reports settings_row_missing when the settings update matches no row', async () => {
        const db = fakeDb({
            returningFor: (call) => (call.table === schema.recipeColorSettings ? [] : [{ id: 3 }])
        });
        const result = await applyRecipeUpdates(
            db, schema,
            [{ recipeId: 3, slug: 's', type: 'COLOR', after: { shadingEffect: 2, exposureCompensation: -3 } }],
            { apply: true }
        );

        expect(result.written).toBe(0);
        expect(result.failures).toEqual([
            { kind: 'write', entity: 'recipe', id: 3, error: 'settings_row_missing' }
        ]);
        // The mirror is still written: with no settings row it is the only
        // value normalizeRecipeRow can fall back to.
        expect(db.calls.map((c) => c.table)).toEqual([schema.recipeColorSettings, schema.recipes]);
    });

    it('isolates a failing recipe row and keeps writing the rest', async () => {
        const db = fakeDb({ shouldFail: (call) => call.values.shadingEffect === 99 });
        const result = await applyRecipeUpdates(db, schema, [
            { recipeId: 3, slug: 's', type: 'COLOR', after: { shadingEffect: 99, exposureCompensation: 0 } },
            { recipeId: 4, slug: 's2', type: 'COLOR', after: { shadingEffect: 1, exposureCompensation: 2 } }
        ], { apply: true });

        expect(result.written).toBe(1);
        expect(result.failures).toEqual([
            { kind: 'write', entity: 'recipe', id: 3, error: 'db write failed' }
        ]);
    });
});

describe('selectImages / selectSampleImageRows query shape', () => {
    function queryRecorder(rows) {
        const rec = { proj: null, where: null, joined: false };
        const chain = {
            select(proj) { rec.proj = proj; return chain; },
            from() { return chain; },
            innerJoin() { rec.joined = true; return chain; },
            where(cond) { rec.where = cond; return Promise.resolve(rows); },
            then(resolve) { return Promise.resolve(rows).then(resolve); }
        };
        return { database: chain, rec };
    }

    const col = (name) => ({ name });
    const querySchema = {
        images: {
            id: col('id'), uuid: col('uuid'), preparedObjectKey: col('prepared_object_key'),
            camera: col('camera'), lens: col('lens'), shutterSpeed: col('shutter_speed'),
            aperture: col('aperture'), focalLength: col('focal_length'), iso: col('iso'),
            createdAt: col('created_at'), finalizedAt: col('finalized_at'), smallUrl: col('small_url')
        },
        recipeSampleImages: {
            recipeId: col('recipe_id'), imageId: col('image_id'), isPrimary: col('is_primary')
        }
    };

    it('selectImages filters on preparedObjectKey AND (finalizedAt OR smallUrl)', async () => {
        const { database, rec } = queryRecorder([
            { id: 1 }, { id: 1 }, { id: 2 }
        ]);
        const rows = await selectImages(database, querySchema, {});
        // innerJoin dedup still collapses repeated ids
        expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
        const where = JSON.stringify(rec.where);
        expect(where).toContain('prepared_object_key');
        expect(where).toContain('finalized_at');
        expect(where).toContain('small_url');
        expect(where).toContain(' or ');
    });

    it('selectSampleImageRows projects smallUrl alongside finalizedAt', async () => {
        const { database, rec } = queryRecorder([]);
        await selectSampleImageRows(database, querySchema, {});
        expect(rec.proj).toHaveProperty('smallUrl', querySchema.images.smallUrl);
        expect(rec.proj).toHaveProperty('finalizedAt', querySchema.images.finalizedAt);
        expect(rec.proj).toHaveProperty('preparedObjectKey', querySchema.images.preparedObjectKey);
    });
});

describe('parseArgs', () => {
    it('defaults to a dry run with no filters', () => {
        expect(parseArgs([])).toEqual({ apply: false, force: false, imageIds: [], recipeIds: [], help: false });
    });

    it('parses flags and repeatable id filters', () => {
        expect(parseArgs(['--apply', '--force', '--image', '10', '--image', '11', '--recipe', '5'])).toEqual({
            apply: true, force: true, imageIds: [10, 11], recipeIds: [5], help: false
        });
    });

    it('returns help', () => {
        expect(parseArgs(['--help']).help).toBe(true);
    });

    it('throws on an unknown flag', () => {
        expect(() => parseArgs(['--nope'])).toThrow(/Usage/);
    });

    it('throws on a non-integer id', () => {
        expect(() => parseArgs(['--image', 'abc'])).toThrow(/integer/);
    });
});

describe('fetchExifText', () => {
    let base;
    let paths;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), 'exif-fetch-'));
        paths = cachePaths(base);
        await ensureCacheDirs(paths);
    });

    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    const image = { id: 1, uuid: 'u1', preparedObjectKey: 'authors/a/recipes/r/u1.jpg' };

    function deps(over = {}) {
        return {
            getObject: async () => ({ value: Buffer.from('JPEGBYTES') }),
            readBody: async (r) => r.value,
            parseMetadata: async () => ({ success: true, data: 'Camera Model Name : OM-3\n' }),
            storageClient: {}, namespaceName: 'ns', bucketName: 'orig',
            exiftoolArgs: ['-Model'],
            ...over
        };
    }

    it('returns cached text without fetching', async () => {
        await writeRawCache(paths, 'u1', 'CACHED\n');
        let called = false;
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: deps({ getObject: async () => { called = true; return {}; } })
        });
        expect(result).toEqual({ raw: 'CACHED\n', source: 'cache', status: 'ok' });
        expect(called).toBe(false);
    });

    it('fetches, parses, and writes the cache on a miss', async () => {
        const result = await fetchExifText({ image, paths, progress: new Map(), force: false, deps: deps() });
        expect(result).toEqual({ raw: 'Camera Model Name : OM-3\n', source: 'fetch', status: 'ok' });
        expect(await readRawCache(paths, 'u1')).toBe('Camera Model Name : OM-3\n');
    });

    it('bypasses a present cache entry when forced, and rewrites the cache', async () => {
        await writeRawCache(paths, 'u1', 'STALE\n');
        let called = false;
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: true,
            deps: deps({ getObject: async () => { called = true; return { value: Buffer.from('JPEGBYTES') }; } })
        });
        expect(called).toBe(true);
        expect(result).toEqual({ raw: 'Camera Model Name : OM-3\n', source: 'fetch', status: 'ok' });
        expect(await readRawCache(paths, 'u1')).toBe('Camera Model Name : OM-3\n');
    });

    it('skips a prior failure unless forced', async () => {
        const progress = new Map([['u1', { status: 'download_failed' }]]);
        const result = await fetchExifText({ image, paths, progress, force: false, deps: deps() });
        expect(result).toEqual({ raw: null, source: 'skipped', status: 'skipped_prior_failure' });
    });

    it('re-fetches a prior failure when forced', async () => {
        const progress = new Map([['u1', { status: 'download_failed' }]]);
        const result = await fetchExifText({ image, paths, progress, force: true, deps: deps() });
        expect(result.status).toBe('ok');
    });

    it('reports parse_failed when exiftool returns success:false', async () => {
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: deps({ parseMetadata: async () => ({ success: false, error: 'bad' }) })
        });
        expect(result).toEqual({ raw: null, source: 'fetch', status: 'parse_failed' });
    });

    it('reports parse_failed when parseMetadata throws (WASM abort / corrupt file)', async () => {
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: deps({ parseMetadata: async () => { throw new Error('memory access out of bounds'); } })
        });
        expect(result).toEqual({ raw: null, source: 'fetch', status: 'parse_failed' });
    });

    it('reports download_failed when getObject throws', async () => {
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: deps({ getObject: async () => { throw new Error('404'); } })
        });
        expect(result).toEqual({ raw: null, source: 'fetch', status: 'download_failed' });
    });
});

describe('run', () => {
    let base;
    let paths;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), 'exif-run-'));
        paths = cachePaths(base);
        await ensureCacheDirs(paths);
    });

    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    function fixtures({ deps: depsOver = {}, dbOptions = {} } = {}) {
        const parsed = parseRecipeSettingsFromExif(RUN_RAW);
        const runSchema = {
            images: { __t: 'images', id: { name: 'id' }, finalizedAt: {}, preparedObjectKey: {}, smallUrl: {} },
            recipes: { __t: 'recipes', id: { name: 'id' } },
            recipeColorSettings: { __t: 'rcs', recipeId: {} },
            recipeMonoSettings: { __t: 'rms', recipeId: {} },
            recipeSampleImages: { __t: 'rsi' }
        };
        const dbCalls = [];
        const database = {
            update: makeUpdater({
                calls: dbCalls,
                returningFor: () => [{ recipeId: 90 }],
                ...dbOptions
            })
        };
        const deps = {
            selectImages: async () => ([
                { id: 1, uuid: 'i1', preparedObjectKey: 'k/i1.jpg', camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null }
            ]),
            selectRecipeRows: async () => ([
                { id: 90, slug: 'a_r', type: parsed.recipeType, recipeFingerprint: computeRecipeFingerprint(parsed), shadingEffect: 0, exposureCompensation: 0 }
            ]),
            selectSampleImageRows: async () => ([
                { recipeId: 90, imageId: 1, uuid: 'i1', isPrimary: true, createdAt: '2026-01-01T00:00:00Z', preparedObjectKey: 'k/i1.jpg', finalizedAt: '2026-01-02T00:00:00Z' }
            ]),
            getObject: async () => ({ value: Buffer.from('bytes') }),
            readBody: async (r) => r.value,
            parseMetadata: async () => ({ success: true, data: RUN_RAW }),
            storageClient: {}, namespaceName: 'ns', bucketName: 'orig',
            exiftoolArgs: ['-Model'],
            ...depsOver
        };
        return { schema: runSchema, database, deps, dbCalls, parsed };
    }

    const ARGS = { apply: false, force: false, imageIds: [], recipeIds: [] };
    const NOW = () => new Date('2026-08-27T00:00:00Z');

    it('dry run: builds plans, writes a report, touches no DB rows', async () => {
        const { schema: s, database, deps, dbCalls } = fixtures();
        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        expect(dbCalls).toEqual([]);
        expect(report.applied).toBe(false);
        expect(report.cameraUpdates).toHaveLength(1);
        expect(report.cameraUpdates[0].after.camera).toBe('OM-3');
        expect(report.shadingExposureUpdates).toHaveLength(1);
        expect(report.shadingExposureUpdates[0].after).toEqual({ shadingEffect: 0, exposureCompensation: -3 });

        const onDisk = JSON.parse(await readFileFs(paths.reportFile, 'utf8'));
        expect(onDisk.counts.imagesScanned).toBe(1);
    });

    it('apply: performs image and recipe writes', async () => {
        const { schema: s, database, deps, dbCalls } = fixtures();
        const report = await run({ database, schema: s, paths, args: { ...ARGS, apply: true }, deps, now: NOW });
        expect(report.applied).toBe(true);
        // 1 image update + 1 mono settings table + 1 recipes mirror = 3
        expect(dbCalls).toHaveLength(3);
        expect(report.counts.imageRowsWritten).toBe(1);
        expect(report.counts.recipesWritten).toBe(1);
        expect(report.failures).toEqual([]);
    });

    it('apply: a failing row is reported with its id and does not abort the run', async () => {
        let imageWrites = 0;
        const { schema: s, database, deps, dbCalls } = fixtures({
            deps: {
                selectImages: async () => ([1, 2, 3].map((id) => ({
                    id, uuid: `i${id}`, preparedObjectKey: `k/i${id}.jpg`,
                    camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null
                })))
            },
            dbOptions: {
                shouldFail: (call) => call.table?.__t === 'images' && ++imageWrites === 2
            }
        });

        const report = await run({ database, schema: s, paths, args: { ...ARGS, apply: true }, deps, now: NOW });

        expect(report.counts.cameraUpdates).toBe(3);
        expect(report.counts.imageRowsWritten).toBe(2);
        expect(report.failures).toContainEqual({
            kind: 'write', entity: 'image', id: 2, error: 'db write failed'
        });
        // The recipe phase still ran despite the image-phase failure.
        expect(report.counts.recipesWritten).toBe(1);
        expect(dbCalls.filter((c) => c.table.__t === 'images')).toHaveLength(3);
    });

    it('--image scopes the recipe phase to recipes using those images', async () => {
        let recipeIdsSeen;
        let sampleIdsSeen;
        let imageIdsSeen;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectRecipeIdsForImages: async (_db, _schema, { imageIds }) => { imageIdsSeen = imageIds; return [90]; },
                selectRecipeRows: async (_db, _schema, { recipeIds }) => { recipeIdsSeen = recipeIds; return []; },
                selectSampleImageRows: async (_db, _schema, { recipeIds }) => { sampleIdsSeen = recipeIds; return []; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS, imageIds: [1], recipeIds: [7] }, deps, now: NOW });

        expect(imageIdsSeen).toEqual([1]);
        expect(recipeIdsSeen).toEqual([7, 90]);
        expect(sampleIdsSeen).toEqual([7, 90]);
    });

    it('--image skips the recipe phase entirely when those images back no recipe', async () => {
        let recipeRowsCalled = false;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectRecipeIdsForImages: async () => [],
                selectRecipeRows: async () => { recipeRowsCalled = true; return []; },
                selectSampleImageRows: async () => { throw new Error('should not be called'); }
            }
        });

        const report = await run({ database, schema: s, paths, args: { ...ARGS, imageIds: [1] }, deps, now: NOW });

        expect(recipeRowsCalled).toBe(false);
        expect(report.counts.recipesScanned).toBe(0);
        expect(report.shadingExposureUpdates).toEqual([]);
    });

    it('does not fetch exif for sample images that are not usable sources', async () => {
        let fetchCalls = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => [],
                selectSampleImageRows: async () => ([
                    { recipeId: 90, imageId: 5, uuid: 'i5', isPrimary: true, createdAt: '2026-01-01T00:00:00Z', preparedObjectKey: 'k/i5.jpg', finalizedAt: null }
                ]),
                getObject: async () => { fetchCalls += 1; throw new Error('404'); }
            }
        });

        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        expect(fetchCalls).toBe(0);
        expect(report.failures).toEqual([]);
        expect(report.skippedNoSource).toEqual([{ recipeId: 90, slug: 'a_r', reason: 'no_sample_image' }]);
    });

    it('fetches exif and stages metadata for a non-finalized legacy sample image with a smallUrl', async () => {
        let fetchCalls = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => ([
                    {
                        id: 5, uuid: 'i5', preparedObjectKey: 'k/i5.jpg',
                        camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null
                    }
                ]),
                selectSampleImageRows: async () => ([
                    {
                        recipeId: 90, imageId: 5, uuid: 'i5', isPrimary: true,
                        createdAt: '2026-01-01T00:00:00Z', preparedObjectKey: 'k/i5.jpg',
                        finalizedAt: null, smallUrl: 'https://cdn/i5-small.jpg'
                    }
                ]),
                getObject: async () => { fetchCalls += 1; return { value: Buffer.from('bytes') }; }
            }
        });

        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        expect(fetchCalls).toBe(1);
        expect(report.cameraUpdates).toHaveLength(1);
        expect(report.cameraUpdates[0].after.camera).toBe('OM-3');
        // Recipe phase used the non-finalized sample image as its EXIF source.
        expect(report.shadingExposureUpdates).toHaveLength(1);
        expect(report.shadingExposureUpdates[0].sourceImageId).toBe(5);
        expect(report.skippedNoSource).toEqual([]);
    });

    it('does not append a progress line for a checkpoint skip', async () => {
        await appendProgress(paths, { uuid: 'i1', imageId: 1, status: 'download_failed' });
        const { schema: s, database, deps } = fixtures();

        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        const lines = (await readFileFs(paths.progressFile, 'utf8')).trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({ uuid: 'i1', status: 'download_failed' });
        expect(report.failures).toContainEqual({
            kind: 'fetch', id: 1, uuid: 'i1', status: 'skipped_prior_failure'
        });
    });

    it('reports image-level skips in their own bucket', async () => {
        const { schema: s, database, deps } = fixtures({
            deps: { parseMetadata: async () => ({ success: false, error: 'bad' }) }
        });

        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        expect(report.skippedImages).toEqual([
            { imageId: 1, uuid: 'i1', reason: 'image_exif_unavailable' }
        ]);
        expect(report.skippedNoSource).toEqual([
            { recipeId: 90, slug: 'a_r', reason: 'source_exif_unavailable' }
        ]);
        expect(report.counts.skippedImages).toBe(1);
        expect(report.counts.skippedRecipes).toBe(1);
    });

    const manyImages = (ids) => ids.map((id) => ({
        id, uuid: `i${id}`, preparedObjectKey: `k/i${id}.jpg`,
        camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null
    }));

    it('disposes the WASM instance once per disposeEvery fetched images', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 2,
                dispose: async () => { disposeCount += 1; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // 5 WASM parses, dispose every 2 => floor(5 / 2) = 2
        expect(disposeCount).toBe(2);
    });

    it('never disposes when every image is a cache hit', async () => {
        let disposeCount = 0;
        for (const id of [1, 2, 3, 4]) await writeRawCache(paths, `i${id}`, RUN_RAW);
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 1,
                dispose: async () => { disposeCount += 1; },
                parseMetadata: async () => { throw new Error('should not parse a cache hit'); }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        expect(disposeCount).toBe(0);
    });

    it('a download_failed image does not count toward the dispose interval', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 2,
                dispose: async () => { disposeCount += 1; },
                getObject: async ({ objectName }) => {
                    if (objectName === 'k/i2.jpg') throw new Error('404');
                    return { value: Buffer.from('bytes') };
                }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // Only i1, i3, i4 reach the WASM => 3 parses => floor(3 / 2) = 1 dispose.
        expect(disposeCount).toBe(1);
    });

    it('formatSummary mentions the flagged and fallback buckets', () => {
        const summary = formatSummary({
            counts: { imagesScanned: 1, recipesScanned: 1 },
            cameraUpdates: [], nulledFields: [], shadingExposureUpdates: [],
            flaggedMismatch: [{ recipeId: 1, slug: 's' }], sourceFallback: [],
            skippedNoSource: [], skippedImages: [{ imageId: 2 }], failures: []
        });
        expect(summary).toMatch(/flaggedMismatch: 1/);
        expect(summary).toMatch(/skippedImages: 1/);
    });

    it('formatSummary does not throw on a report with missing buckets', () => {
        expect(() => formatSummary({})).not.toThrow();
        expect(formatSummary({})).toMatch(/failures: 0/);
    });

    it('completes and writes report even when dispose throws mid-loop', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 2,
                dispose: async () => {
                    disposeCount += 1;
                    if (disposeCount === 1) throw new Error('dispose failed');
                }
            }
        });

        // Should not throw and should complete normally
        const report = await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // Report should have been written
        expect(report).toHaveProperty('counts.wasmDisposes');
        // The dispose was called at least once before the exception
        expect(disposeCount).toBeGreaterThanOrEqual(1);
        // Report should show expected WASM runs (5 images, 2 cache hits = 3 WASM runs)
        expect(report.counts.wasmRuns).toBe(5);

        // Verify report was actually written to disk
        const onDisk = JSON.parse(await readFileFs(paths.reportFile, 'utf8'));
        expect(onDisk.counts.wasmRuns).toBe(5);
    });

    it('clamps disposeEvery to 50 when set to 0', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 0,
                dispose: async () => { disposeCount += 1; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // 10 WASM runs with disposeEvery clamped to 50 => floor(10 / 50) = 0
        expect(disposeCount).toBe(0);
    });

    it('clamps disposeEvery to 50 when set to negative', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: -5,
                dispose: async () => { disposeCount += 1; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // 10 WASM runs with disposeEvery clamped to 50 => floor(10 / 50) = 0
        expect(disposeCount).toBe(0);
    });

    it('clamps disposeEvery to 50 when set to non-integer', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: 1.5,
                dispose: async () => { disposeCount += 1; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // 10 WASM runs with disposeEvery clamped to 50 => floor(10 / 50) = 0
        expect(disposeCount).toBe(0);
    });

    it('clamps disposeEvery from env var when NaN', async () => {
        let disposeCount = 0;
        const { schema: s, database, deps } = fixtures({
            deps: {
                selectImages: async () => manyImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                selectRecipeRows: async () => [],
                selectSampleImageRows: async () => [],
                disposeEvery: NaN,
                dispose: async () => { disposeCount += 1; }
            }
        });

        await run({ database, schema: s, paths, args: { ...ARGS }, deps, now: NOW });

        // 10 WASM runs with disposeEvery clamped to 50 => floor(10 / 50) = 0
        expect(disposeCount).toBe(0);
    });
});
