import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile as writeFileFs } from 'node:fs/promises';

import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import {
    cachePaths,
    ensureCacheDirs,
    readRawCache,
    writeRawCache,
    loadProgress,
    appendProgress
} from '../lib/exif-reprocess-cache.js';
import { readObjectStorageBodyToBuffer } from '../lib/oci/objectStorage.js';
import { RECIPE_EXIFTOOL_ARGS } from '../lib/exifparse.js';
import { buildImagePlan, buildRecipePlan, isUsableSampleImage } from '../lib/exif-reprocess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const USAGE = [
    'Usage:',
    '  node --env-file=.env.local --import tsx/esm scripts/reprocess-exif-metadata.mjs [options]',
    '',
    'Options:',
    '  --apply             Perform DB writes (default: dry run, writes nothing)',
    '  --force             Ignore the progress checkpoint and re-fetch every image',
    '  --image <id>        Restrict to this image id (repeatable). Also narrows the',
    '                      recipe phase to recipes whose sample images are in the set',
    '                      (unioned with any --recipe ids)',
    '  --recipe <id>       Restrict to this recipe id (repeatable)',
    '  --help, -h          Show this help'
].join('\n');

function fail(message) {
    throw new Error(`${message}\n\n${USAGE}`);
}

function parseIntId(value, flag) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(n) || n <= 0) fail(`${flag} must be a positive integer, got: ${value}`);
    return n;
}

export function parseArgs(argv) {
    const out = { apply: false, force: false, imageIds: [], recipeIds: [], help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--apply') out.apply = true;
        else if (arg === '--force') out.force = true;
        else if (arg === '--image') { out.imageIds.push(parseIntId(argv[++i], '--image')); }
        else if (arg === '--recipe') { out.recipeIds.push(parseIntId(argv[++i], '--recipe')); }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else fail(`Unknown argument: ${arg}`);
    }
    return out;
}

/**
 * Resolve one image's raw exiftool text: cache hit, checkpoint skip, or a
 * fresh object-storage fetch + WASM exiftool parse. Pure I/O around
 * injected `deps`; the caller records progress.
 */
export async function fetchExifText({ image, paths, progress, force, deps }) {
    // --force means "re-fetch every image": it has to bypass the raw cache as
    // well as the progress checkpoint, otherwise a stale cached parse wins.
    if (!force) {
        const cached = await readRawCache(paths, image.uuid);
        if (cached != null) {
            return { raw: cached, source: 'cache', status: 'ok' };
        }
    }

    const prior = progress.get(image.uuid);
    if (!force && prior && prior.status !== 'ok') {
        return { raw: null, source: 'skipped', status: 'skipped_prior_failure' };
    }

    let buffer;
    try {
        const response = await deps.getObject({
            client: deps.storageClient,
            namespaceName: deps.namespaceName,
            bucketName: deps.bucketName,
            objectName: image.preparedObjectKey
        });
        buffer = await deps.readBody(response);
    } catch {
        return { raw: null, source: 'fetch', status: 'download_failed' };
    }

    const basename = image.preparedObjectKey.split('/').pop() || `${image.uuid}.jpg`;
    const file = new File([buffer], basename, { type: 'image/jpeg' });
    let result;
    try {
        result = await deps.parseMetadata(file, { args: deps.exiftoolArgs });
    } catch {
        // A thrown WASM/parse error (corrupt file, or a catchable abort) is
        // recorded like any other parse failure rather than crashing run().
        return { raw: null, source: 'fetch', status: 'parse_failed' };
    }
    if (!result?.success || typeof result.data !== 'string') {
        return { raw: null, source: 'fetch', status: 'parse_failed' };
    }

    await writeRawCache(paths, image.uuid, result.data);
    return { raw: result.data, source: 'fetch', status: 'ok' };
}

export async function selectImages(database, schema, { imageIds = [], recipeIds = [] } = {}) {
    const { images, recipeSampleImages } = schema;
    // In scope: a downloadable original (preparedObjectKey) that is either
    // finalized OR fully migrated to published renditions (smallUrl). The
    // smallUrl clause pulls in legacy-imported images that never had
    // finalizedAt stamped. Images with only a legacy full_size_url and no
    // preparedObjectKey stay out — different fetch path.
    const conditions = [
        isNotNull(images.preparedObjectKey),
        or(isNotNull(images.finalizedAt), isNotNull(images.smallUrl))
    ];
    if (imageIds.length > 0) conditions.push(inArray(images.id, imageIds));

    let query = database
        .select({
            id: images.id,
            uuid: images.uuid,
            preparedObjectKey: images.preparedObjectKey,
            camera: images.camera,
            lens: images.lens,
            shutterSpeed: images.shutterSpeed,
            aperture: images.aperture,
            focalLength: images.focalLength,
            iso: images.iso
        })
        .from(images);

    if (recipeIds.length > 0) {
        query = query
            .innerJoin(recipeSampleImages, eq(recipeSampleImages.imageId, images.id));
        conditions.push(inArray(recipeSampleImages.recipeId, recipeIds));
    }

    const rows = await query.where(and(...conditions));
    // innerJoin can duplicate an image shared by several targeted recipes.
    const byId = new Map();
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()];
}

export async function selectRecipeRows(database, schema, { recipeIds = [] } = {}) {
    const { recipes } = schema;
    const base = database
        .select({
            id: recipes.id,
            slug: recipes.slug,
            type: recipes.type,
            recipeFingerprint: recipes.recipeFingerprint,
            shadingEffect: recipes.shadingEffect,
            exposureCompensation: recipes.exposureCompensation
        })
        .from(recipes);
    const rows = recipeIds.length > 0 ? await base.where(inArray(recipes.id, recipeIds)) : await base;
    return rows;
}

/**
 * The recipe ids that use any of `imageIds` as a sample image. Used to scope
 * Phase 3 when only `--image` was given, so an image-scoped run cannot walk
 * (and rewrite) every recipe in the database.
 */
export async function selectRecipeIdsForImages(database, schema, { imageIds = [] } = {}) {
    if (imageIds.length === 0) return [];
    const { recipeSampleImages } = schema;
    const rows = await database
        .select({ recipeId: recipeSampleImages.recipeId })
        .from(recipeSampleImages)
        .where(inArray(recipeSampleImages.imageId, imageIds));
    return [...new Set(rows.map((row) => row.recipeId))];
}

export async function selectSampleImageRows(database, schema, { recipeIds = [] } = {}) {
    const { images, recipeSampleImages } = schema;
    const conditions = [];
    if (recipeIds.length > 0) conditions.push(inArray(recipeSampleImages.recipeId, recipeIds));

    const query = database
        .select({
            recipeId: recipeSampleImages.recipeId,
            imageId: images.id,
            uuid: images.uuid,
            isPrimary: recipeSampleImages.isPrimary,
            createdAt: images.createdAt,
            preparedObjectKey: images.preparedObjectKey,
            finalizedAt: images.finalizedAt,
            smallUrl: images.smallUrl
        })
        .from(recipeSampleImages)
        .innerJoin(images, eq(images.id, recipeSampleImages.imageId));

    return conditions.length > 0 ? await query.where(and(...conditions)) : await query;
}

function writeFailure(entity, id, error) {
    return { kind: 'write', entity, id, error: error?.message ?? String(error) };
}

/**
 * Per-row image writes. A failure on one row is recorded and the loop
 * continues, so `written` always reflects the rows that really committed.
 */
export async function applyImageUpdates(database, schema, cameraUpdates, { apply }) {
    const failures = [];
    if (!apply) return { written: 0, failures };
    const { images } = schema;
    let written = 0;
    for (const update of cameraUpdates) {
        try {
            await database
                .update(images)
                .set({ ...update.after })
                .where(eq(images.id, update.imageId));
            written += 1;
        } catch (err) {
            failures.push(writeFailure('image', update.imageId, err));
        }
    }
    return { written, failures };
}

/**
 * Per-row recipe writes. The type's settings table is written FIRST because
 * `normalizeRecipeRow` (lib/recipe-data.js) lets it win over the legacy
 * mirror on `recipes`: a partial failure then leaves the cosmetic mirror
 * stale rather than the value the UI actually renders.
 *
 * Recipes predating the settings-table backfill can have no settings row at
 * all (`app/recipes/[id]/actions.js` throws 'Recipe settings not found' for
 * the same state). `.returning()` detects that: the recipe is reported in
 * `failures` as `settings_row_missing` and is not counted as written. The
 * mirror is still written, because with no settings row it is the only value
 * `normalizeRecipeRow` can fall back to.
 */
export async function applyRecipeUpdates(database, schema, shadingExposureUpdates, { apply }) {
    const failures = [];
    if (!apply) return { written: 0, failures };
    const { recipes, recipeColorSettings, recipeMonoSettings } = schema;
    let written = 0;
    for (const update of shadingExposureUpdates) {
        const values = {
            shadingEffect: update.after.shadingEffect,
            exposureCompensation: update.after.exposureCompensation
        };
        const settingsTable = update.type === 'MONO' ? recipeMonoSettings : recipeColorSettings;

        try {
            const settingsRows = await database
                .update(settingsTable)
                .set(values)
                .where(eq(settingsTable.recipeId, update.recipeId))
                .returning({ recipeId: settingsTable.recipeId });
            const settingsMissing = !Array.isArray(settingsRows) || settingsRows.length === 0;

            await database
                .update(recipes)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(recipes.id, update.recipeId));

            if (settingsMissing) {
                failures.push(writeFailure('recipe', update.recipeId, 'settings_row_missing'));
                continue;
            }
            written += 1;
        } catch (err) {
            failures.push(writeFailure('recipe', update.recipeId, err));
        }
    }
    return { written, failures };
}

function groupSampleImages(rows) {
    const byRecipeId = new Map();
    for (const row of rows) {
        if (!byRecipeId.has(row.recipeId)) byRecipeId.set(row.recipeId, []);
        byRecipeId.get(row.recipeId).push({
            imageId: row.imageId,
            uuid: row.uuid,
            isPrimary: row.isPrimary,
            createdAt: row.createdAt,
            preparedObjectKey: row.preparedObjectKey,
            finalizedAt: row.finalizedAt,
            smallUrl: row.smallUrl
        });
    }
    return byRecipeId;
}

export async function run({ database, schema, paths, args, deps, now = () => new Date() }) {
    const startedAt = now().toISOString();
    await ensureCacheDirs(paths);
    const progress = await loadProgress(paths);

    const selectImagesFn = deps.selectImages ?? selectImages;
    const selectRecipeRowsFn = deps.selectRecipeRows ?? selectRecipeRows;
    const selectSampleImageRowsFn = deps.selectSampleImageRows ?? selectSampleImageRows;
    const selectRecipeIdsForImagesFn = deps.selectRecipeIdsForImages ?? selectRecipeIdsForImages;

    const argImageIds = args.imageIds ?? [];
    const argRecipeIds = args.recipeIds ?? [];

    const images = await selectImagesFn(database, schema, { imageIds: argImageIds, recipeIds: argRecipeIds });

    // `--image` scopes Phase 3 as well: only recipes that actually use one of
    // those images, unioned with any explicit `--recipe` ids. An empty
    // recipeIds list means "no filter" to the selects, so an image that backs
    // no recipe must skip Phase 3 outright rather than fall through to the
    // whole table.
    const recipeIds = argImageIds.length > 0
        ? [...new Set([
            ...argRecipeIds,
            ...(await selectRecipeIdsForImagesFn(database, schema, { imageIds: argImageIds }))
        ])]
        : argRecipeIds;
    const skipRecipePhase = argImageIds.length > 0 && recipeIds.length === 0;

    const recipeRows = skipRecipePhase ? [] : await selectRecipeRowsFn(database, schema, { recipeIds });
    const sampleRows = skipRecipePhase ? [] : await selectSampleImageRowsFn(database, schema, { recipeIds });
    const sampleImagesByRecipeId = groupSampleImages(sampleRows);

    // Every image we may need exif for: the scanned images plus any sample
    // image backing a recipe (dedup by id). The sample-row select does not
    // apply the finalized-or-migrated usability predicate, so run the same
    // isUsableSampleImage check pickSourceImage uses — an unusable row would
    // only ever produce a download_failed entry nobody can act on.
    const needExif = new Map();
    for (const image of images) needExif.set(image.id, image);
    for (const list of sampleImagesByRecipeId.values()) {
        for (const sample of list) {
            if (!isUsableSampleImage(sample)) continue;
            if (!needExif.has(sample.imageId)) {
                needExif.set(sample.imageId, {
                    id: sample.imageId,
                    uuid: sample.uuid,
                    preparedObjectKey: sample.preparedObjectKey
                });
            }
        }
    }

    // @uswriting/exiftool reuses one WASM instance whose linear memory only
    // grows; over a ~1k-image run it hits its ceiling and hard-aborts. Dispose
    // it every N WASM parses so the next call rebuilds a fresh instance.
    const rawDisposeEvery = Number(deps.disposeEvery ?? process.env.RECIPE_EXIF_DISPOSE_EVERY ?? 50);
    const disposeEvery = Number.isInteger(rawDisposeEvery) && rawDisposeEvery > 0 ? rawDisposeEvery : 50;

    const rawByImageId = new Map();
    const failures = [];
    let fetched = 0;
    let cacheHits = 0;
    let wasmRuns = 0;

    for (const image of needExif.values()) {
        if (!image.preparedObjectKey) continue;
        const outcome = await fetchExifText({ image, paths, progress, force: args.force, deps });
        if (outcome.source === 'cache') cacheHits += 1;
        if (outcome.source === 'fetch' && outcome.status === 'ok') fetched += 1;

        // A cache hit never touches the WASM; a download_failed never reached
        // parseMetadata. Anything else fetched DID run the WASM.
        if (outcome.source === 'fetch' && outcome.status !== 'download_failed') {
            wasmRuns += 1;
            if (wasmRuns % disposeEvery === 0) {
                try {
                    await deps.dispose?.();
                } catch {
                    // Silently continue the run even if dispose fails; the
                    // report must be written regardless.
                }
            }
        }

        if (outcome.status === 'ok' && outcome.raw != null) {
            rawByImageId.set(image.id, outcome.raw);
        } else {
            failures.push({ kind: 'fetch', id: image.id, uuid: image.uuid, status: outcome.status });
        }

        // Only record outcomes that did work. Appending a `skipped_*` line
        // would make it the last-wins entry in loadProgress and erase the
        // original download_failed / parse_failed reason.
        if (outcome.source !== 'cache' && outcome.status !== 'skipped_prior_failure') {
            await appendProgress(paths, { uuid: image.uuid, imageId: image.id, status: outcome.status });
        }
    }

    const imagePlan = buildImagePlan(images, rawByImageId);
    const recipePlan = buildRecipePlan(recipeRows, sampleImagesByRecipeId, rawByImageId);

    // Both appliers isolate failures per row, so one bad row cannot skip the
    // rest of its phase or the other phase, and the counts below always
    // describe what actually committed.
    const imageWrites = await applyImageUpdates(database, schema, imagePlan.cameraUpdates, { apply: args.apply });
    const recipeWrites = await applyRecipeUpdates(database, schema, recipePlan.shadingExposureUpdates, { apply: args.apply });
    failures.push(...imageWrites.failures, ...recipeWrites.failures);

    const skippedImages = imagePlan.skippedNoExif.map((s) => ({
        imageId: s.imageId,
        uuid: s.uuid,
        reason: 'image_exif_unavailable'
    }));

    const report = {
        startedAt,
        finishedAt: now().toISOString(),
        applied: Boolean(args.apply),
        counts: {
            imagesScanned: images.length,
            recipesScanned: recipeRows.length,
            exifFetched: fetched,
            exifCacheHits: cacheHits,
            wasmRuns,
            wasmDisposes: Math.floor(wasmRuns / disposeEvery),
            cameraUpdates: imagePlan.cameraUpdates.length,
            shadingExposureUpdates: recipePlan.shadingExposureUpdates.length,
            flaggedMismatch: recipePlan.flaggedMismatch.length,
            imageRowsWritten: imageWrites.written,
            recipesWritten: recipeWrites.written,
            skippedRecipes: recipePlan.skippedNoSource.length,
            skippedImages: skippedImages.length,
            failures: failures.length
        },
        cameraUpdates: imagePlan.cameraUpdates,
        nulledFields: imagePlan.nulledFields,
        shadingExposureUpdates: recipePlan.shadingExposureUpdates,
        flaggedMismatch: recipePlan.flaggedMismatch,
        sourceFallback: recipePlan.sourceFallback,
        // Recipe-level and image-level skips stay in separate buckets: they
        // have different shapes and call for different follow-up.
        skippedNoSource: recipePlan.skippedNoSource,
        skippedImages,
        failures
    };

    await writeFileFs(paths.reportFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
}

// Printed after a production --apply, so every bucket deref is guarded: a
// malformed or partial report must still summarize rather than throw.
export function formatSummary(report) {
    const c = report?.counts ?? {};
    const len = (bucket) => (bucket ?? []).length;
    const lines = [
        report?.applied ? 'MODE: APPLY (writes performed)' : 'MODE: DRY RUN (no writes)',
        `images scanned: ${c.imagesScanned ?? 0}`,
        `recipes scanned: ${c.recipesScanned ?? 0}`,
        `camera updates: ${len(report?.cameraUpdates)}`,
        `  nulled fields (review): ${len(report?.nulledFields)}`,
        `shading/exposure updates: ${len(report?.shadingExposureUpdates)}`,
        `flaggedMismatch: ${len(report?.flaggedMismatch)}`,
        `sourceFallback: ${len(report?.sourceFallback)}`,
        `skippedNoSource: ${len(report?.skippedNoSource)}`,
        `skippedImages: ${len(report?.skippedImages)}`,
        `failures: ${len(report?.failures)}`
    ];
    return lines.join('\n');
}

export async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        return;
    }
    if (!process.env.NETLIFY_DATABASE_URL) {
        fail('NETLIFY_DATABASE_URL is not set.');
    }
    const bucketName = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
    if (!bucketName) fail('OCI_IMAGES_ORIGINAL_BUCKET is not set.');

    const [{ db }, schema, oci, exiftool] = await Promise.all([
        import('../db/index.ts'),
        import('../db/schema.ts'),
        import('../lib/oci/objectStorage.js'),
        import('@uswriting/exiftool')
    ]);

    const paths = cachePaths(process.cwd());
    const deps = {
        getObject: oci.getObject,
        readBody: oci.readObjectStorageBodyToBuffer,
        parseMetadata: exiftool.parseMetadata,
        dispose: exiftool.dispose,
        storageClient: oci.getObjectStorageClientFromEnv(),
        namespaceName: oci.getObjectStorageNamespaceFromEnv(),
        bucketName,
        exiftoolArgs: RECIPE_EXIFTOOL_ARGS
    };

    try {
        const report = await run({ database: db, schema, paths, args, deps });
        console.log(formatSummary(report));
        console.log(`\nFull report: ${paths.reportFile}`);
    } finally {
        await exiftool.dispose().catch(() => {});
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

export { REPO_ROOT, USAGE, cachePaths, ensureCacheDirs, loadProgress, appendProgress, readObjectStorageBodyToBuffer, RECIPE_EXIFTOOL_ARGS };
