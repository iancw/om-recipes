import { describe, it, expect } from 'vitest';
import {
    CAMERA_METADATA_FIELDS,
    toStoredCameraMetadataText
} from '../lib/exif-reprocess.js';
import { getRecipeType } from '../lib/recipeFingerprint.js';

describe('toStoredCameraMetadataText', () => {
    it('trims strings', () => {
        expect(toStoredCameraMetadataText('  OM-3  ')).toBe('OM-3');
    });

    it('returns null for non-strings and blanks', () => {
        expect(toStoredCameraMetadataText(null)).toBeNull();
        expect(toStoredCameraMetadataText(undefined)).toBeNull();
        expect(toStoredCameraMetadataText(42)).toBeNull();
        expect(toStoredCameraMetadataText('   ')).toBeNull();
    });

    it('caps length at 200 characters', () => {
        expect(toStoredCameraMetadataText('x'.repeat(250))).toHaveLength(200);
    });
});

describe('CAMERA_METADATA_FIELDS', () => {
    it('is the six camelCase image metadata fields', () => {
        expect([...CAMERA_METADATA_FIELDS]).toEqual([
            'camera', 'lens', 'shutterSpeed', 'aperture', 'focalLength', 'iso'
        ]);
    });
});

describe('getRecipeType is exported from recipeFingerprint', () => {
    it('classifies a color payload as COLOR', () => {
        expect(getRecipeType({ recipeType: 'COLOR', yellow: 3 })).toBe('COLOR');
    });

    it('classifies a mono payload as MONO', () => {
        expect(getRecipeType({ recipeType: 'MONO', monochromeProfile: 'Monochrome Profile 1' })).toBe('MONO');
    });
});

import { diffCameraMetadata, classifyRecipe } from '../lib/exif-reprocess.js';
import { computeRecipeFingerprint } from '../lib/recipeFingerprint.js';

describe('diffCameraMetadata', () => {
    const CURRENT = {
        camera: null, lens: 'OLD LENS', shutterSpeed: '1/800',
        aperture: '8.0', focalLength: '17.0 mm', iso: '320'
    };

    it('reports no change when sanitized values all match', () => {
        const result = diffCameraMetadata(CURRENT, { ...CURRENT, iso: '  320  ' });
        expect(result.changed).toBe(false);
        expect(result.update).toBeNull();
        expect(result.changedFields).toEqual([]);
        expect(result.nulledFields).toEqual([]);
    });

    it('stages a full six-field payload when any field changes', () => {
        const fresh = { ...CURRENT, camera: 'OM-3', lens: 'OLYMPUS M.17mm F1.8' };
        const result = diffCameraMetadata(CURRENT, fresh);
        expect(result.changed).toBe(true);
        expect(result.changedFields.sort()).toEqual(['camera', 'lens']);
        expect(result.update).toEqual({
            camera: 'OM-3', lens: 'OLYMPUS M.17mm F1.8', shutterSpeed: '1/800',
            aperture: '8.0', focalLength: '17.0 mm', iso: '320'
        });
    });

    it('flags fields going from a value to null', () => {
        const fresh = { ...CURRENT, lens: null };
        const result = diffCameraMetadata(CURRENT, fresh);
        expect(result.changed).toBe(true);
        expect(result.nulledFields).toEqual([{ field: 'lens', before: 'OLD LENS' }]);
    });
});

describe('classifyRecipe', () => {
    const FRESH = {
        recipeType: 'COLOR',
        yellow: 5, orange: 4, orangeRed: 3, red: 1, magenta: 1, violet: 1,
        blue: 1, blueCyan: 1, cyan: 1, greenCyan: 3, green: 4, yellowGreen: 5,
        contrast: -1, sharpness: 3, highlights: 2, shadows: -2, midtones: 0,
        whiteBalance2: 'Custom WB 1', whiteBalanceTemperature: 5800,
        whiteBalanceAmberOffset: 2, whiteBalanceGreenOffset: 1,
        shadingEffect: 2, exposureCompensation: -3
    };

    it('returns match with a shading/exposure payload when the fingerprint is unchanged', () => {
        const storedFingerprint = computeRecipeFingerprint(FRESH);
        const result = classifyRecipe({ storedType: 'COLOR', storedFingerprint, fresh: FRESH });
        expect(result.result).toBe('match');
        expect(result.payload).toEqual({ shadingEffect: 2, exposureCompensation: -3 });
        expect(result.freshType).toBe('COLOR');
    });

    it('coerces null shading/exposure to 0 in the match payload', () => {
        const fresh = { ...FRESH, shadingEffect: null, exposureCompensation: null };
        const storedFingerprint = computeRecipeFingerprint(fresh);
        const result = classifyRecipe({ storedType: 'COLOR', storedFingerprint, fresh });
        expect(result.payload).toEqual({ shadingEffect: 0, exposureCompensation: 0 });
    });

    it('returns mismatch when the recomputed fingerprint differs', () => {
        const result = classifyRecipe({
            storedType: 'COLOR',
            storedFingerprint: 'deadbeef',
            fresh: FRESH
        });
        expect(result.result).toBe('mismatch');
        expect(result.freshFingerprint).toBe(computeRecipeFingerprint(FRESH));
    });

    it('returns mismatch when the fresh recipe type differs from the stored type', () => {
        const storedFingerprint = computeRecipeFingerprint(FRESH);
        const result = classifyRecipe({ storedType: 'MONO', storedFingerprint, fresh: FRESH });
        expect(result.result).toBe('mismatch');
        expect(result.freshType).toBe('COLOR');
    });
});

import { readFileSync } from 'node:fs';
import {
    isUsableSampleImage,
    pickSourceImage,
    buildImagePlan,
    buildRecipePlan
} from '../lib/exif-reprocess.js';
import {
    parseRecipeSettingsFromExif,
    parseCameraMetadataFromExif
} from '../lib/exifparse.js';

function fixture(name) {
    return readFileSync(
        new URL(`../openspec/changes/monochrome-profiles/sample-exif/${name}`, import.meta.url),
        'utf8'
    );
}

describe('isUsableSampleImage', () => {
    const sample = { preparedObjectKey: 'authors/a/recipes/r/1.jpg', finalizedAt: '2026-01-02T00:00:00Z' };

    it('requires a prepared object key plus either a finalizedAt or a smallUrl', () => {
        expect(isUsableSampleImage(sample)).toBe(true);
        expect(isUsableSampleImage({ ...sample, finalizedAt: null })).toBe(false);
        expect(isUsableSampleImage({ ...sample, preparedObjectKey: null })).toBe(false);
        expect(isUsableSampleImage({ ...sample, preparedObjectKey: '' })).toBe(false);
        expect(isUsableSampleImage(null)).toBe(false);
    });

    it('admits a non-finalized legacy image that has published renditions (smallUrl)', () => {
        const legacy = {
            preparedObjectKey: 'authors/a/recipes/r/1.jpg',
            finalizedAt: null,
            smallUrl: 'https://cdn.example/authors/a/recipes/r/1-small.jpg'
        };
        expect(isUsableSampleImage(legacy)).toBe(true);
    });

    it('rejects a non-finalized image with neither finalizedAt nor smallUrl', () => {
        expect(isUsableSampleImage({
            preparedObjectKey: 'authors/a/recipes/r/1.jpg',
            finalizedAt: null,
            smallUrl: null
        })).toBe(false);
    });

    it('rejects an image with no prepared object key even when smallUrl is present', () => {
        expect(isUsableSampleImage({
            preparedObjectKey: null,
            finalizedAt: null,
            smallUrl: 'https://cdn.example/authors/a/recipes/r/1-small.jpg'
        })).toBe(false);
    });
});

describe('pickSourceImage', () => {
    const valid = (over) => ({
        imageId: 1, uuid: 'u1', isPrimary: false,
        createdAt: '2026-01-01T00:00:00Z',
        preparedObjectKey: 'authors/a/recipes/r/1.jpg',
        finalizedAt: '2026-01-02T00:00:00Z',
        ...over
    });

    it('returns null when there are no finalized sample images', () => {
        expect(pickSourceImage([])).toEqual({ image: null, fallback: false });
        expect(pickSourceImage([valid({ finalizedAt: null })])).toEqual({ image: null, fallback: false });
        expect(pickSourceImage([valid({ preparedObjectKey: null })])).toEqual({ image: null, fallback: false });
    });

    it('treats a non-finalized image with a smallUrl as a valid source', () => {
        const legacy = valid({ imageId: 9, uuid: 'u9', finalizedAt: null, smallUrl: 'https://cdn/small.jpg' });
        expect(pickSourceImage([legacy])).toEqual({ image: legacy, fallback: true });
    });

    it('prefers the primary image with no fallback flag', () => {
        const primary = valid({ imageId: 2, uuid: 'u2', isPrimary: true });
        const result = pickSourceImage([valid(), primary]);
        expect(result).toEqual({ image: primary, fallback: false });
    });

    it('falls back to the earliest valid image when none is primary', () => {
        const older = valid({ imageId: 3, uuid: 'u3', createdAt: '2025-06-01T00:00:00Z' });
        const newer = valid({ imageId: 4, uuid: 'u4', createdAt: '2026-06-01T00:00:00Z' });
        const result = pickSourceImage([newer, older]);
        expect(result).toEqual({ image: older, fallback: true });
    });
});

describe('buildImagePlan', () => {
    const rawWithCamera = fixture('P4070386.JPG.txt'); // Camera Model Name: OM-3

    it('stages a camera update for an image missing camera/lens', () => {
        const images = [{
            id: 10, uuid: 'img10',
            camera: null, lens: null,
            shutterSpeed: '1/800', aperture: '8.0', focalLength: '17.0 mm', iso: '320'
        }];
        const plan = buildImagePlan(images, new Map([[10, rawWithCamera]]));
        expect(plan.cameraUpdates).toHaveLength(1);
        expect(plan.cameraUpdates[0].imageId).toBe(10);
        expect(plan.cameraUpdates[0].after.camera).toBe('OM-3');
        expect(plan.cameraUpdates[0].after.lens).toBe('OLYMPUS M.17mm F1.8');
        expect(plan.nulledFields).toEqual([]);
        expect(plan.skippedNoExif).toEqual([]);
    });

    it('makes no update when the parsed values already match', () => {
        const fresh = parseCameraMetadataFromExif(rawWithCamera);
        const images = [{ id: 11, uuid: 'img11', ...fresh }];
        const plan = buildImagePlan(images, new Map([[11, rawWithCamera]]));
        expect(plan.cameraUpdates).toEqual([]);
    });

    it('records images whose exif could not be fetched', () => {
        const images = [{ id: 12, uuid: 'img12', camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null }];
        const plan = buildImagePlan(images, new Map());
        expect(plan.skippedNoExif).toEqual([{ imageId: 12, uuid: 'img12' }]);
        expect(plan.cameraUpdates).toEqual([]);
    });
});

describe('buildRecipePlan', () => {
    const raw = fixture('P4070386.JPG.txt'); // MONO, shading 0, exposure -0.3 -> -3
    const parsed = parseRecipeSettingsFromExif(raw);

    const sampleImage = {
        imageId: 100, uuid: 'i100', isPrimary: true,
        createdAt: '2026-01-01T00:00:00Z',
        preparedObjectKey: 'authors/a/recipes/r/100.jpg',
        finalizedAt: '2026-01-02T00:00:00Z'
    };

    it('stages a shading/exposure update for a fingerprint-matching recipe', () => {
        const recipe = {
            id: 500, slug: 'a_r', type: parsed.recipeType,
            recipeFingerprint: computeRecipeFingerprint(parsed),
            shadingEffect: 0, exposureCompensation: 0
        };
        const plan = buildRecipePlan(
            [recipe],
            new Map([[500, [sampleImage]]]),
            new Map([[100, raw]])
        );
        expect(plan.shadingExposureUpdates).toHaveLength(1);
        expect(plan.shadingExposureUpdates[0]).toMatchObject({
            recipeId: 500, type: parsed.recipeType, sourceImageId: 100,
            before: { shadingEffect: 0, exposureCompensation: 0 },
            after: { shadingEffect: 0, exposureCompensation: -3 }
        });
        expect(plan.flaggedMismatch).toEqual([]);
    });

    it('does not stage an update when the values already match', () => {
        const recipe = {
            id: 501, slug: 'a_r2', type: parsed.recipeType,
            recipeFingerprint: computeRecipeFingerprint(parsed),
            shadingEffect: 0, exposureCompensation: -3
        };
        const plan = buildRecipePlan([recipe], new Map([[501, [sampleImage]]]), new Map([[100, raw]]));
        expect(plan.shadingExposureUpdates).toEqual([]);
    });

    it('flags a recipe whose source image re-parses to a different fingerprint', () => {
        const recipe = {
            id: 502, slug: 'a_r3', type: parsed.recipeType,
            recipeFingerprint: 'stale-fingerprint',
            shadingEffect: 0, exposureCompensation: 0
        };
        const plan = buildRecipePlan([recipe], new Map([[502, [sampleImage]]]), new Map([[100, raw]]));
        expect(plan.shadingExposureUpdates).toEqual([]);
        expect(plan.flaggedMismatch).toHaveLength(1);
        expect(plan.flaggedMismatch[0]).toMatchObject({ recipeId: 502, sourceImageId: 100 });
    });

    it('records a recipe with no usable sample image', () => {
        const recipe = { id: 503, slug: 'a_r4', type: 'COLOR', recipeFingerprint: 'x', shadingEffect: 0, exposureCompensation: 0 };
        const plan = buildRecipePlan([recipe], new Map(), new Map());
        expect(plan.skippedNoSource).toEqual([{ recipeId: 503, slug: 'a_r4', reason: 'no_sample_image' }]);
    });

    it('notes when a non-primary fallback image was used', () => {
        const fallbackImg = { ...sampleImage, isPrimary: false };
        const recipe = {
            id: 504, slug: 'a_r5', type: parsed.recipeType,
            recipeFingerprint: computeRecipeFingerprint(parsed),
            shadingEffect: 0, exposureCompensation: -3
        };
        const plan = buildRecipePlan([recipe], new Map([[504, [fallbackImg]]]), new Map([[100, raw]]));
        expect(plan.sourceFallback).toEqual([{ recipeId: 504, slug: 'a_r5', usedImageId: 100 }]);
    });
});
