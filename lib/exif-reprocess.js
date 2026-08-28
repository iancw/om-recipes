import { getRecipeType, computeRecipeFingerprint } from './recipeFingerprint.js';
import {
    parseCameraMetadataFromExif,
    parseRecipeSettingsFromExif
} from './exifparse.js';
import { getRecipeImageObjectKey } from './recipe-image-assets.js';

export { getRecipeType };

/**
 * The object-storage key for an image's original, or null when none can be
 * determined. Prefers `preparedObjectKey`; for legacy imported rows that were
 * never stamped with one, falls back to the key embedded in a
 * `/assets/images/<rendition>/…` `fullSizeUrl` or `smallUrl`. Shared by the
 * reprocess script's image scan, its source-image picker, and its fetch step
 * so all three agree on which images are reachable.
 */
export function resolveImageObjectKey(image) {
    return getRecipeImageObjectKey({
        preparedObjectKey: image?.preparedObjectKey ?? null,
        fullSizeUrl: image?.fullSizeUrl ?? null,
        smallUrl: image?.smallUrl ?? null
    });
}

// The six camelCase fields shown alongside sample images. Order matters:
// used to build DB update payloads and before/after diffs.
export const CAMERA_METADATA_FIELDS = Object.freeze([
    'camera',
    'lens',
    'shutterSpeed',
    'aperture',
    'focalLength',
    'iso'
]);

// Always be sanitizing data in real sites!
// Coerces a camera-metadata value (e.g. from parsed EXIF) into a trimmed,
// length-capped string, or null for anything invalid/empty. Guards the
// images.camera/lens/shutterSpeed/aperture/focalLength/iso text columns
// against non-string input and unbounded length. Shared by the upload
// path (app/upload/actions.js) and the reprocess script so the two
// cannot drift.
export const toStoredCameraMetadataText = (v) => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 200);
};

/**
 * Compare the current stored camera metadata against a freshly parsed set.
 * Both inputs are objects keyed by CAMERA_METADATA_FIELDS; values are
 * sanitized with toStoredCameraMetadataText before comparison so that
 * whitespace / sentinel differences do not count as changes.
 *
 * When anything differs, `update` is the full six-field sanitized object
 * to write (we always write all six columns together). `nulledFields`
 * lists fields that currently hold a value but would be blanked — callers
 * surface these for human review.
 */
export function diffCameraMetadata(current, fresh) {
    const sanitizedCurrent = {};
    const sanitizedFresh = {};
    for (const field of CAMERA_METADATA_FIELDS) {
        sanitizedCurrent[field] = toStoredCameraMetadataText(current?.[field]);
        sanitizedFresh[field] = toStoredCameraMetadataText(fresh?.[field]);
    }

    const changedFields = CAMERA_METADATA_FIELDS.filter(
        (field) => sanitizedCurrent[field] !== sanitizedFresh[field]
    );

    if (changedFields.length === 0) {
        return { changed: false, update: null, changedFields: [], nulledFields: [] };
    }

    const nulledFields = changedFields
        .filter((field) => sanitizedCurrent[field] !== null && sanitizedFresh[field] === null)
        .map((field) => ({ field, before: sanitizedCurrent[field] }));

    return { changed: true, update: sanitizedFresh, changedFields, nulledFields };
}

function normalizeType(value) {
    return String(value ?? '').trim().toUpperCase() === 'MONO' ? 'MONO' : 'COLOR';
}

/**
 * Decide what to do with a recipe given its stored identity and a fresh
 * parse of its source sample image.
 *
 * - 'match': the recomputed recipe fingerprint AND the recipe type are
 *   unchanged, so the source image still faithfully represents the recipe.
 *   `payload` carries the two fields this script is allowed to write.
 * - 'mismatch': fingerprint or type moved. The script writes nothing and
 *   the caller flags the recipe for manual review.
 */
export function classifyRecipe({ storedType, storedFingerprint, fresh }) {
    const freshType = getRecipeType(fresh);
    const freshFingerprint = computeRecipeFingerprint(fresh);

    if (freshType === normalizeType(storedType) && freshFingerprint === storedFingerprint) {
        return {
            result: 'match',
            freshType,
            freshFingerprint,
            payload: {
                shadingEffect: fresh?.shadingEffect ?? 0,
                exposureCompensation: fresh?.exposureCompensation ?? 0
            }
        };
    }

    return { result: 'mismatch', freshType, freshFingerprint };
}

/**
 * A sample image is only a usable EXIF source when its original is reachable
 * in object storage (a `preparedObjectKey`, or a key derivable from a legacy
 * `/assets/images/…` URL) AND it is either finalized OR has published
 * renditions (`smallUrl` set). The `smallUrl` clause admits fully-migrated
 * legacy images that import scripts never stamped `finalizedAt` on. Exported
 * so the orchestrator can apply the same predicate when deciding which images
 * to fetch — seeding a fetch for an unusable row produces spurious
 * `download_failed` noise.
 */
export function isUsableSampleImage(sample) {
    return Boolean(resolveImageObjectKey(sample))
        && (sample?.finalizedAt != null || sample?.smallUrl != null);
}

/**
 * Choose the sample image whose EXIF should drive a recipe's
 * shading/exposure. Primary image wins; otherwise the earliest usable
 * sample image, with fallback=true so the caller can note it.
 */
export function pickSourceImage(sampleImages) {
    const usable = (sampleImages ?? []).filter(isUsableSampleImage);
    if (usable.length === 0) return { image: null, fallback: false };

    const primary = usable.find((sample) => sample.isPrimary);
    if (primary) return { image: primary, fallback: false };

    const earliest = [...usable].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )[0];
    return { image: earliest, fallback: true };
}

function pickCameraFields(row) {
    const out = {};
    for (const field of CAMERA_METADATA_FIELDS) out[field] = row?.[field] ?? null;
    return out;
}

/**
 * Build the per-image camera-metadata change plan.
 * `rawByImageId` maps image id -> raw exiftool output text.
 */
export function buildImagePlan(images, rawByImageId) {
    const cameraUpdates = [];
    const nulledFields = [];
    const skippedNoExif = [];

    for (const image of images ?? []) {
        const raw = rawByImageId?.get(image.id);
        if (typeof raw !== 'string' || raw === '') {
            skippedNoExif.push({ imageId: image.id, uuid: image.uuid });
            continue;
        }

        const fresh = parseCameraMetadataFromExif(raw);
        const before = pickCameraFields(image);
        const diff = diffCameraMetadata(before, fresh);
        if (!diff.changed) continue;

        cameraUpdates.push({
            imageId: image.id,
            uuid: image.uuid,
            before,
            after: diff.update
        });
        for (const nulled of diff.nulledFields) {
            nulledFields.push({ imageId: image.id, uuid: image.uuid, ...nulled });
        }
    }

    return { cameraUpdates, nulledFields, skippedNoExif };
}

const RECIPE_SETTING_SUMMARY_FIELDS = Object.freeze([
    'yellow', 'orange', 'orangeRed', 'red', 'magenta', 'violet',
    'blue', 'blueCyan', 'cyan', 'greenCyan', 'green', 'yellowGreen',
    'contrast', 'sharpness', 'highlights', 'shadows', 'midtones',
    'shadingEffect', 'exposureCompensation',
    'whiteBalanceTemperature', 'whiteBalanceAmberOffset', 'whiteBalanceGreenOffset',
    'monochromeProfile', 'monochromeColor', 'monochromeColorStrength',
    'filmGrain', 'filmHue', 'monochromeVignetting'
]);

function summarizeSettings(settings) {
    const out = {};
    for (const field of RECIPE_SETTING_SUMMARY_FIELDS) {
        if (settings?.[field] !== undefined) out[field] = settings[field];
    }
    return out;
}

/**
 * Build the per-recipe shading/exposure change plan plus the review
 * buckets. `sampleImagesByRecipeId` maps recipe id -> SampleImage[];
 * `rawByImageId` maps image id -> raw exiftool output text.
 */
export function buildRecipePlan(recipes, sampleImagesByRecipeId, rawByImageId) {
    const shadingExposureUpdates = [];
    const flaggedMismatch = [];
    const sourceFallback = [];
    const skippedNoSource = [];

    for (const recipe of recipes ?? []) {
        const { image, fallback } = pickSourceImage(sampleImagesByRecipeId?.get(recipe.id));
        if (!image) {
            skippedNoSource.push({ recipeId: recipe.id, slug: recipe.slug, reason: 'no_sample_image' });
            continue;
        }

        const raw = rawByImageId?.get(image.imageId);
        if (typeof raw !== 'string' || raw === '') {
            skippedNoSource.push({ recipeId: recipe.id, slug: recipe.slug, reason: 'source_exif_unavailable' });
            continue;
        }

        if (fallback) {
            sourceFallback.push({ recipeId: recipe.id, slug: recipe.slug, usedImageId: image.imageId });
        }

        const fresh = parseRecipeSettingsFromExif(raw);
        const classified = classifyRecipe({
            storedType: recipe.type,
            storedFingerprint: recipe.recipeFingerprint,
            fresh
        });

        if (classified.result === 'mismatch') {
            flaggedMismatch.push({
                recipeId: recipe.id,
                slug: recipe.slug,
                sourceImageId: image.imageId,
                storedType: recipe.type,
                freshType: classified.freshType,
                stored: {
                    shadingEffect: recipe.shadingEffect,
                    exposureCompensation: recipe.exposureCompensation,
                    recipeFingerprint: recipe.recipeFingerprint
                },
                fresh: {
                    ...summarizeSettings(fresh),
                    recipeFingerprint: classified.freshFingerprint
                }
            });
            continue;
        }

        const before = {
            shadingEffect: recipe.shadingEffect ?? 0,
            exposureCompensation: recipe.exposureCompensation ?? 0
        };
        const after = classified.payload;
        if (before.shadingEffect === after.shadingEffect &&
            before.exposureCompensation === after.exposureCompensation) {
            continue;
        }

        shadingExposureUpdates.push({
            recipeId: recipe.id,
            slug: recipe.slug,
            type: classified.freshType,
            sourceImageId: image.imageId,
            before,
            after
        });
    }

    return { shadingExposureUpdates, flaggedMismatch, sourceFallback, skippedNoSource };
}
