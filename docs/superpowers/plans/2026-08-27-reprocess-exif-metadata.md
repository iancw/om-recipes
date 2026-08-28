# Reprocess EXIF Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-off maintenance script that re-downloads every finalized original JPEG, re-runs exiftool, and writes back the per-image camera metadata and per-recipe shading-effect / exposure-compensation values that earlier parser bugs left missing or wrong.

**Architecture:** Pure decision logic (diffing, recipe classification, source-image selection, plan building) lives in `lib/exif-reprocess.js` with no I/O and full unit coverage. Filesystem caching / checkpointing lives in `lib/exif-reprocess-cache.js`. `scripts/reprocess-exif-metadata.mjs` is the I/O shell: argument parsing, Drizzle queries, OCI object fetch, the WASM exiftool call, applying writes, and emitting a JSON report. Dry-run is the default; `--apply` performs writes.

**Tech Stack:** Node 22+ ESM, Vitest, Drizzle ORM (`drizzle-orm/neon-http` via `db/index.ts`), `@uswriting/exiftool` (WASM), OCI Object Storage SDK (`lib/oci/objectStorage.js`).

**Spec:** `docs/superpowers/specs/2026-08-27-reprocess-exif-metadata-design.md`

## Global Constraints

- Node engine is `22.x` (`package.json`); the runtime here is v24. `File` and `Buffer` are global — do not import them.
- Scripts run via `node --env-file=.env.local --import tsx/esm scripts/<name>.mjs`, matching the existing `db:backfill:*` npm scripts. `.mjs` files may `import` `.ts` modules (`db/index.ts`, `db/schema.ts`) under `tsx/esm`.
- `drizzle-orm/neon-http` does **not** support `db.transaction()`. All writes must be per-row and idempotent (safe to re-run).
- Tests live in `tests/**/*.test.js` (Vitest, `environment: 'node'`). Run the suite with `npm test`.
- exiftool: always call `parseMetadata(file, { args: RECIPE_EXIFTOOL_ARGS })` with the list imported from `lib/exifparse.js` — never a hand-written tag list. Call `dispose()` from `@uswriting/exiftool` once at the end of a run so the process can exit.
- Fingerprints are **never written** by this script. `recipe_fingerprint` is read only, as the match/flag decision input.
- Recipe `shading_effect` / `exposure_compensation` columns are `smallint NOT NULL DEFAULT 0` on all three tables (`recipes`, `recipe_color_settings`, `recipe_mono_settings`). Coerce parsed `null` to `0` before writing.
- Camera-metadata text columns on `images` (`camera`, `lens`, `shutter_speed`, `aperture`, `focal_length`, `iso`) are nullable `text`; stored values are trimmed and capped at 200 characters.
- Transient run state goes under `./.exif-reprocess/` (relative to CWD), which must be gitignored.

---

## File Structure

**Created:**
- `lib/exif-reprocess.js` — pure logic: `toStoredCameraMetadataText`, `CAMERA_METADATA_FIELDS`, `diffCameraMetadata`, `classifyRecipe`, `pickSourceImage`, `buildImagePlan`, `buildRecipePlan`. No `fs`, no network, no DB.
- `lib/exif-reprocess-cache.js` — filesystem cache + checkpoint: `cachePaths`, `ensureCacheDirs`, `readRawCache`, `writeRawCache`, `loadProgress`, `appendProgress`.
- `scripts/reprocess-exif-metadata.mjs` — I/O shell + orchestration: `parseArgs`, `fetchExifText`, `selectImages`, `selectRecipeRows`, `selectSampleImageRows`, `applyImageUpdates`, `applyRecipeUpdates`, `run`, `main`.
- `tests/exif-reprocess.test.js` — unit tests for `lib/exif-reprocess.js`.
- `tests/exif-reprocess-cache.test.js` — unit tests for `lib/exif-reprocess-cache.js`.
- `tests/reprocess-exif-metadata.test.js` — unit tests for the script's helpers and `run` (all deps faked).
- `tests/reprocess-exif-metadata-integration.test.js` — one end-to-end test through the real WASM exiftool.

**Modified:**
- `lib/oci/objectStorage.js` — add `readObjectStorageBodyToBuffer(response)`.
- `app/upload/actions.js` — import `toStoredCameraMetadataText` from `lib/exif-reprocess.js` instead of defining it locally (no behavior change).
- `lib/recipeFingerprint.js` — add `export` to the existing `getRecipeType` function.
- `.gitignore` — add `/.exif-reprocess/`.
- `package.json` — add `"image:reprocess-exif"` script.

---

## Task 1: Shared sanitizer + exported recipe-type helper

Extract the camera-metadata sanitizer into the new pure module and export the recipe-type classifier that later tasks need. Pure refactor — no behavior change.

**Files:**
- Create: `lib/exif-reprocess.js`
- Modify: `app/upload/actions.js` (remove local `toStoredCameraMetadataText`, add import)
- Modify: `lib/recipeFingerprint.js:90` (add `export` keyword to `function getRecipeType`)
- Test: `tests/exif-reprocess.test.js`

**Interfaces:**
- Produces:
  - `CAMERA_METADATA_FIELDS: readonly string[]` — `['camera','lens','shutterSpeed','aperture','focalLength','iso']`
  - `toStoredCameraMetadataText(v: unknown): string | null`
  - `getRecipeType(recipeSettings: object): 'COLOR' | 'MONO'` (re-exported from `lib/recipeFingerprint.js`)

- [ ] **Step 1: Write the failing test**

Create `tests/exif-reprocess.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/exif-reprocess.test.js`
Expected: FAIL — cannot resolve `../lib/exif-reprocess.js`; `getRecipeType` is not exported.

- [ ] **Step 3: Add `export` to `getRecipeType`**

In `lib/recipeFingerprint.js`, change the declaration (currently around line 90):

```js
function getRecipeType(recipeSettings) {
```

to:

```js
export function getRecipeType(recipeSettings) {
```

- [ ] **Step 4: Create `lib/exif-reprocess.js`**

```js
import { getRecipeType } from './recipeFingerprint.js';

export { getRecipeType };

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
```

- [ ] **Step 5: Update `app/upload/actions.js`**

Remove the local `toStoredCameraMetadataText` definition (the `const toStoredCameraMetadataText = (v) => { ... }` block and its comment, around lines 603–613). Add to the import block near the other `lib/` imports:

```js
import { toStoredCameraMetadataText } from '../../lib/exif-reprocess.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/exif-reprocess.test.js tests/prepare-recipe-upload.test.js tests/recipeFingerprint.test.js`
Expected: PASS. (`prepare-recipe-upload.test.js` exercises the upload path that used the moved helper.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions from the move.

- [ ] **Step 8: Commit**

```bash
git add lib/exif-reprocess.js lib/recipeFingerprint.js app/upload/actions.js tests/exif-reprocess.test.js
git commit -m "refactor: extract shared camera-metadata sanitizer, export getRecipeType"
```

---

## Task 2: Camera-metadata diff + recipe classification

Add the two core decision functions. Both are pure; both are fed already-parsed objects.

**Files:**
- Modify: `lib/exif-reprocess.js`
- Test: `tests/exif-reprocess.test.js`

**Interfaces:**
- Consumes: `toStoredCameraMetadataText`, `CAMERA_METADATA_FIELDS`, `getRecipeType` (Task 1); `computeRecipeFingerprint` from `lib/recipeFingerprint.js`; `parseCameraMetadataFromExif` / `parseRecipeSettingsFromExif` shapes from `lib/exifparse.js`.
- Produces:
  - `diffCameraMetadata(current, fresh)` →
    `{ changed: boolean, update: Record<field,string|null> | null, changedFields: string[], nulledFields: Array<{ field: string, before: string }> }`
    where `current` and `fresh` are objects keyed by `CAMERA_METADATA_FIELDS`.
  - `classifyRecipe({ storedType, storedFingerprint, fresh })` →
    `{ result: 'match', freshType: 'COLOR'|'MONO', freshFingerprint: string, payload: { shadingEffect: number, exposureCompensation: number } }`
    or `{ result: 'mismatch', freshType, freshFingerprint }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/exif-reprocess.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/exif-reprocess.test.js`
Expected: FAIL — `diffCameraMetadata`/`classifyRecipe` are not exported.

- [ ] **Step 3: Implement both functions**

Append to `lib/exif-reprocess.js`:

```js
import { computeRecipeFingerprint } from './recipeFingerprint.js';

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/exif-reprocess.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/exif-reprocess.js tests/exif-reprocess.test.js
git commit -m "feat: add camera-metadata diff and recipe classification for EXIF reprocess"
```

---

## Task 3: Source-image selection + plan builders

Add the functions that turn raw exiftool text plus DB rows into a structured change plan.

**Files:**
- Modify: `lib/exif-reprocess.js`
- Test: `tests/exif-reprocess.test.js`

**Interfaces:**
- Consumes: `diffCameraMetadata`, `classifyRecipe` (Task 2); `parseCameraMetadataFromExif`, `parseRecipeSettingsFromExif` from `lib/exifparse.js`.
- Produces:
  - `pickSourceImage(sampleImages)` → `{ image: SampleImage | null, fallback: boolean }`
    where `SampleImage` is `{ imageId: number, uuid: string, isPrimary: boolean, createdAt: string|Date, preparedObjectKey: string|null, finalizedAt: string|Date|null }`.
  - `buildImagePlan(images, rawByImageId)` →
    `{ cameraUpdates: Array<{ imageId, uuid, before, after }>, nulledFields: Array<{ imageId, uuid, field, before }>, skippedNoExif: Array<{ imageId, uuid }> }`
    where `images` is `Array<{ id, uuid, camera, lens, shutterSpeed, aperture, focalLength, iso }>` and `rawByImageId` is a `Map<number, string>`.
  - `buildRecipePlan(recipes, sampleImagesByRecipeId, rawByImageId)` →
    `{ shadingExposureUpdates: Array<{ recipeId, slug, type, sourceImageId, before, after }>, flaggedMismatch: Array<{ recipeId, slug, sourceImageId, storedType, freshType, stored, fresh }>, sourceFallback: Array<{ recipeId, slug, usedImageId }>, skippedNoSource: Array<{ recipeId, slug, reason }> }`
    where `recipes` is `Array<{ id, slug, type, recipeFingerprint, shadingEffect, exposureCompensation }>` and `sampleImagesByRecipeId` is a `Map<number, SampleImage[]>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/exif-reprocess.test.js`:

```js
import { readFileSync } from 'node:fs';
import {
    pickSourceImage,
    buildImagePlan,
    buildRecipePlan
} from '../lib/exif-reprocess.js';
import {
    parseRecipeSettingsFromExif,
    parseCameraMetadataFromExif
} from '../lib/exifparse.js';
import { computeRecipeFingerprint } from '../lib/recipeFingerprint.js';

function fixture(name) {
    return readFileSync(
        new URL(`../openspec/changes/monochrome-profiles/sample-exif/${name}`, import.meta.url),
        'utf8'
    );
}

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/exif-reprocess.test.js`
Expected: FAIL — `pickSourceImage`/`buildImagePlan`/`buildRecipePlan` are not exported.

- [ ] **Step 3: Implement the three functions**

Append to `lib/exif-reprocess.js`:

```js
import {
    parseCameraMetadataFromExif,
    parseRecipeSettingsFromExif
} from './exifparse.js';

function isUsableSampleImage(sample) {
    return sample?.finalizedAt != null && Boolean(sample?.preparedObjectKey);
}

/**
 * Choose the sample image whose EXIF should drive a recipe's
 * shading/exposure. Primary image wins; otherwise the earliest finalized
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
        const diff = diffCameraMetadata(pickCameraFields(image), fresh);
        if (!diff.changed) continue;

        cameraUpdates.push({
            imageId: image.id,
            uuid: image.uuid,
            before: pickCameraFields(image),
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
            type: getRecipeType({ recipeType: recipe.type }),
            sourceImageId: image.imageId,
            before,
            after
        });
    }

    return { shadingExposureUpdates, flaggedMismatch, sourceFallback, skippedNoSource };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/exif-reprocess.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/exif-reprocess.js tests/exif-reprocess.test.js
git commit -m "feat: add source-image selection and change-plan builders for EXIF reprocess"
```

---

## Task 4: `readObjectStorageBodyToBuffer` helper

The OCI `getObject` response body comes back in one of several shapes (a web stream with `.arrayBuffer()`, a `Buffer`/`Uint8Array`, or an async iterable). `app/upload/actions.js` already drains it for hashing; add a shared helper that returns a `Buffer` for feeding into `File`.

**Files:**
- Modify: `lib/oci/objectStorage.js`
- Test: `tests/oci-object-storage-body.test.js`

**Interfaces:**
- Produces: `readObjectStorageBodyToBuffer(response: unknown): Promise<Buffer>` — accepts the raw `getObject` return value or its `.value`/`.body`/`.data`; throws `Error('Object storage response body was empty')` when there is no body, `Error('Unsupported object storage body type')` for an unrecognized shape.

- [ ] **Step 1: Write the failing test**

Create `tests/oci-object-storage-body.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readObjectStorageBodyToBuffer } from '../lib/oci/objectStorage.js';

describe('readObjectStorageBodyToBuffer', () => {
    it('reads a body exposing arrayBuffer()', async () => {
        const response = { value: { arrayBuffer: async () => new TextEncoder().encode('hello').buffer } };
        const buf = await readObjectStorageBodyToBuffer(response);
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.toString('utf8')).toBe('hello');
    });

    it('reads a Buffer body', async () => {
        const buf = await readObjectStorageBodyToBuffer({ body: Buffer.from('abc') });
        expect(buf.toString('utf8')).toBe('abc');
    });

    it('reads an async-iterable body', async () => {
        async function* chunks() {
            yield Buffer.from('ab');
            yield Buffer.from('cd');
        }
        const buf = await readObjectStorageBodyToBuffer({ value: chunks() });
        expect(buf.toString('utf8')).toBe('abcd');
    });

    it('accepts the raw response as the body itself', async () => {
        const buf = await readObjectStorageBodyToBuffer(Buffer.from('xyz'));
        expect(buf.toString('utf8')).toBe('xyz');
    });

    it('throws on an empty body', async () => {
        await expect(readObjectStorageBodyToBuffer({})).rejects.toThrow('empty');
    });

    it('throws on an unsupported body type', async () => {
        await expect(readObjectStorageBodyToBuffer({ value: 42 })).rejects.toThrow('Unsupported');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/oci-object-storage-body.test.js`
Expected: FAIL — `readObjectStorageBodyToBuffer` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `lib/oci/objectStorage.js` (near `getObject`):

```js
/**
 * Drain an OCI getObject response body into a Buffer. The SDK returns the
 * payload under `.value` (browser/edge) or `.body`/`.data` depending on
 * transport; the body itself may be a web stream (arrayBuffer()), a
 * Buffer/Uint8Array, or an async iterable of chunks.
 */
export async function readObjectStorageBodyToBuffer(response) {
    const body = response?.value ?? response?.body ?? response?.data ?? response;

    if (!body) {
        throw new Error('Object storage response body was empty');
    }

    if (typeof body.arrayBuffer === 'function') {
        return Buffer.from(await body.arrayBuffer());
    }

    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        return Buffer.from(body);
    }

    if (typeof body[Symbol.asyncIterator] === 'function' || typeof body[Symbol.iterator] === 'function') {
        const parts = [];
        for await (const chunk of body) {
            if (!chunk) continue;
            parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(parts);
    }

    throw new Error('Unsupported object storage body type');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/oci-object-storage-body.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/oci/objectStorage.js tests/oci-object-storage-body.test.js
git commit -m "feat: add readObjectStorageBodyToBuffer helper"
```

---

## Task 5: Filesystem cache + checkpoint module

`lib/exif-reprocess-cache.js` owns the `./.exif-reprocess/` working directory: raw exiftool text keyed by image UUID, and a `progress.jsonl` append log of per-image outcomes so a re-run skips work it already did.

**Files:**
- Create: `lib/exif-reprocess-cache.js`
- Test: `tests/exif-reprocess-cache.test.js`

**Interfaces:**
- Produces:
  - `cachePaths(baseDir: string)` → `{ root, rawDir, progressFile, reportFile }` (all absolute, joined under `<baseDir>/.exif-reprocess`)
  - `ensureCacheDirs(paths): Promise<void>` — `mkdir -p` for `root` and `rawDir`
  - `readRawCache(paths, uuid: string): Promise<string | null>`
  - `writeRawCache(paths, uuid: string, text: string): Promise<void>`
  - `loadProgress(paths): Promise<Map<string, { status: string, at: string }>>` — last entry per `uuid` wins; missing file → empty map
  - `appendProgress(paths, entry: { uuid: string, imageId: number, status: string }): Promise<void>` — writes one JSON line with an added `at` ISO timestamp

- [ ] **Step 1: Write the failing tests**

Create `tests/exif-reprocess-cache.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    cachePaths,
    ensureCacheDirs,
    readRawCache,
    writeRawCache,
    loadProgress,
    appendProgress
} from '../lib/exif-reprocess-cache.js';

let base;
let paths;

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'exif-reprocess-'));
    paths = cachePaths(base);
    await ensureCacheDirs(paths);
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

describe('cachePaths', () => {
    it('roots everything under <base>/.exif-reprocess', () => {
        expect(paths.root).toBe(join(base, '.exif-reprocess'));
        expect(paths.rawDir).toBe(join(base, '.exif-reprocess', 'raw'));
        expect(paths.progressFile).toBe(join(base, '.exif-reprocess', 'progress.jsonl'));
        expect(paths.reportFile).toBe(join(base, '.exif-reprocess', 'report.json'));
    });
});

describe('raw cache', () => {
    it('returns null for a missing entry', async () => {
        expect(await readRawCache(paths, 'nope')).toBeNull();
    });

    it('round-trips text', async () => {
        await writeRawCache(paths, 'abc', 'Camera Model Name : OM-3\n');
        expect(await readRawCache(paths, 'abc')).toBe('Camera Model Name : OM-3\n');
    });
});

describe('progress log', () => {
    it('returns an empty map when the file does not exist', async () => {
        expect(await loadProgress(paths)).toEqual(new Map());
    });

    it('appends JSON lines with a timestamp and keeps the last status per uuid', async () => {
        await appendProgress(paths, { uuid: 'a', imageId: 1, status: 'download_failed' });
        await appendProgress(paths, { uuid: 'a', imageId: 1, status: 'ok' });
        await appendProgress(paths, { uuid: 'b', imageId: 2, status: 'ok' });

        const progress = await loadProgress(paths);
        expect(progress.get('a').status).toBe('ok');
        expect(progress.get('b').status).toBe('ok');
        expect(typeof progress.get('a').at).toBe('string');

        const rawLines = (await readFile(paths.progressFile, 'utf8')).trim().split('\n');
        expect(rawLines).toHaveLength(3);
        expect(JSON.parse(rawLines[0])).toMatchObject({ uuid: 'a', imageId: 1, status: 'download_failed' });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/exif-reprocess-cache.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/exif-reprocess-cache.js`**

```js
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DIR_NAME = '.exif-reprocess';

export function cachePaths(baseDir) {
    const root = resolve(baseDir, DIR_NAME);
    return {
        root,
        rawDir: join(root, 'raw'),
        progressFile: join(root, 'progress.jsonl'),
        reportFile: join(root, 'report.json')
    };
}

export async function ensureCacheDirs(paths) {
    await mkdir(paths.rawDir, { recursive: true });
}

function rawFile(paths, uuid) {
    return join(paths.rawDir, `${uuid}.txt`);
}

export async function readRawCache(paths, uuid) {
    try {
        return await readFile(rawFile(paths, uuid), 'utf8');
    } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

export async function writeRawCache(paths, uuid, text) {
    await writeFile(rawFile(paths, uuid), text, 'utf8');
}

export async function loadProgress(paths) {
    let contents;
    try {
        contents = await readFile(paths.progressFile, 'utf8');
    } catch (err) {
        if (err?.code === 'ENOENT') return new Map();
        throw err;
    }

    const progress = new Map();
    for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const entry = JSON.parse(trimmed);
            if (entry?.uuid) progress.set(entry.uuid, { status: entry.status, at: entry.at });
        } catch {
            // Ignore a torn final line from an interrupted run.
        }
    }
    return progress;
}

export async function appendProgress(paths, entry) {
    const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
    await appendFile(paths.progressFile, `${line}\n`, 'utf8');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/exif-reprocess-cache.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/exif-reprocess-cache.js tests/exif-reprocess-cache.test.js
git commit -m "feat: add filesystem cache and checkpoint for EXIF reprocess"
```

---

## Task 6: Script skeleton — `parseArgs` and `fetchExifText`

Start `scripts/reprocess-exif-metadata.mjs` with argument parsing and the single-image fetch/cache/exiftool routine. No DB yet.

**Files:**
- Create: `scripts/reprocess-exif-metadata.mjs`
- Test: `tests/reprocess-exif-metadata.test.js`

**Interfaces:**
- Consumes: `cachePaths`/`readRawCache`/`writeRawCache`/`loadProgress`/`appendProgress` (Task 5); `readObjectStorageBodyToBuffer` (Task 4); `RECIPE_EXIFTOOL_ARGS` from `lib/exifparse.js`.
- Produces:
  - `parseArgs(argv: string[])` → `{ apply: boolean, force: boolean, imageIds: number[], recipeIds: number[], help: boolean }`; throws `Error` with a usage string on an unknown flag or a non-integer id.
  - `fetchExifText({ image, paths, progress, force, deps })` → `{ raw: string | null, source: 'cache' | 'fetch' | 'skipped', status: string }`
    - `image`: `{ id: number, uuid: string, preparedObjectKey: string }`
    - `progress`: the `Map` from `loadProgress`
    - `deps`: `{ getObject, readBody, parseMetadata, storageClient, namespaceName, bucketName, exiftoolArgs }`
    - Behaviour: cache hit → `{ raw, source: 'cache', status: 'ok' }`. Cache miss with a non-`ok` prior progress entry and `!force` → `{ raw: null, source: 'skipped', status: 'skipped_prior_failure' }`. Otherwise call `getObject` → `readBody` → `new File([buf], basename, { type: 'image/jpeg' })` → `parseMetadata(file, { args: exiftoolArgs })`; on `result.success` write the raw cache and return `{ raw, source: 'fetch', status: 'ok' }`; on failure return `{ raw: null, source: 'fetch', status: 'parse_failed' }`; on a thrown error return `{ raw: null, source: 'fetch', status: 'download_failed' }`. `fetchExifText` never writes to `progress.jsonl` itself — the caller (`run`, Task 8) does.

- [ ] **Step 1: Write the failing tests**

Create `tests/reprocess-exif-metadata.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePaths, ensureCacheDirs, writeRawCache } from '../lib/exif-reprocess-cache.js';
import { parseArgs, fetchExifText } from '../scripts/reprocess-exif-metadata.mjs';

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
        const { readRawCache } = await import('../lib/exif-reprocess-cache.js');
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

    it('reports download_failed when getObject throws', async () => {
        const result = await fetchExifText({
            image, paths, progress: new Map(), force: false,
            deps: deps({ getObject: async () => { throw new Error('404'); } })
        });
        expect(result).toEqual({ raw: null, source: 'fetch', status: 'download_failed' });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: FAIL — script module does not exist.

- [ ] **Step 3: Create the script with `parseArgs` and `fetchExifText`**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const USAGE = [
    'Usage:',
    '  node --env-file=.env.local --import tsx/esm scripts/reprocess-exif-metadata.mjs [options]',
    '',
    'Options:',
    '  --apply             Perform DB writes (default: dry run, writes nothing)',
    '  --force             Ignore the progress checkpoint and re-fetch every image',
    '  --image <id>        Restrict to this image id (repeatable)',
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
    const cached = await readRawCache(paths, image.uuid);
    if (cached != null) {
        return { raw: cached, source: 'cache', status: 'ok' };
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
    const result = await deps.parseMetadata(file, { args: deps.exiftoolArgs });
    if (!result?.success || typeof result.data !== 'string') {
        return { raw: null, source: 'fetch', status: 'parse_failed' };
    }

    await writeRawCache(paths, image.uuid, result.data);
    return { raw: result.data, source: 'fetch', status: 'ok' };
}

export { REPO_ROOT, USAGE, cachePaths, ensureCacheDirs, loadProgress, appendProgress, readObjectStorageBodyToBuffer, RECIPE_EXIFTOOL_ARGS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reprocess-exif-metadata.mjs tests/reprocess-exif-metadata.test.js
git commit -m "feat: add EXIF reprocess script arg parsing and per-image fetch"
```

---

## Task 7: DB selects + write appliers

Add the Drizzle query helpers and the two write functions to the script. Writes are per-row and gated on `apply`.

**Files:**
- Modify: `scripts/reprocess-exif-metadata.mjs`
- Test: `tests/reprocess-exif-metadata.test.js`

**Interfaces:**
- Consumes: `db` from `db/index.ts`; `recipes`, `recipeColorSettings`, `recipeMonoSettings`, `images`, `recipeSampleImages` from `db/schema.ts`; `eq`, `inArray`, `and`, `isNotNull` from `drizzle-orm`.
- Produces:
  - `selectImages(database, schema, { imageIds, recipeIds }): Promise<Array<{ id, uuid, preparedObjectKey, camera, lens, shutterSpeed, aperture, focalLength, iso }>>` — finalized images (`finalized_at IS NOT NULL AND prepared_object_key IS NOT NULL`), optionally narrowed to `imageIds`, and — when `recipeIds` is non-empty — to images that are a sample image of one of those recipes.
  - `selectRecipeRows(database, schema, { recipeIds }): Promise<Array<{ id, slug, type, recipeFingerprint, shadingEffect, exposureCompensation }>>`
  - `selectSampleImageRows(database, schema, { recipeIds }): Promise<Array<{ recipeId, imageId, uuid, isPrimary, createdAt, preparedObjectKey, finalizedAt }>>`
  - `applyImageUpdates(database, schema, cameraUpdates, { apply }): Promise<{ written: number }>` — for each update, when `apply`, `database.update(images).set({ ...after }).where(eq(images.id, imageId))`. The `images` table has **no** `updatedAt` column (only `createdAt`), so do not set one.
  - `applyRecipeUpdates(database, schema, shadingExposureUpdates, { apply }): Promise<{ written: number }>` — for each update, when `apply`, write `{ shadingEffect, exposureCompensation }` (from `after`) to the legacy mirror on `recipes` (plus `updatedAt`) **and** to the type's settings table (`recipeColorSettings` when `type === 'COLOR'`, else `recipeMonoSettings`), matched by `recipeId`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/reprocess-exif-metadata.test.js`:

```js
import { applyImageUpdates, applyRecipeUpdates } from '../scripts/reprocess-exif-metadata.mjs';

function fakeDb() {
    const calls = [];
    const chain = (table) => ({
        set(values) {
            return {
                where(cond) {
                    calls.push({ table, values, cond });
                    return Promise.resolve([]);
                }
            };
        }
    });
    return { calls, update: (table) => chain(table) };
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
        expect(result).toEqual({ written: 0 });
        expect(db.calls).toEqual([]);
    });

    it('updates the images row when applying', async () => {
        const db = fakeDb();
        const result = await applyImageUpdates(db, schema, updates, { apply: true });
        expect(result).toEqual({ written: 1 });
        expect(db.calls).toHaveLength(1);
        expect(db.calls[0].table).toBe(schema.images);
        expect(db.calls[0].values).toEqual(updates[0].after);
    });
});

describe('applyRecipeUpdates', () => {
    it('writes the mirror and the color settings table for a COLOR recipe', async () => {
        const db = fakeDb();
        const updates = [{ recipeId: 3, slug: 's', type: 'COLOR', after: { shadingEffect: 2, exposureCompensation: -3 } }];
        const result = await applyRecipeUpdates(db, schema, updates, { apply: true });
        expect(result).toEqual({ written: 1 });
        const tables = db.calls.map((c) => c.table);
        expect(tables).toContain(schema.recipes);
        expect(tables).toContain(schema.recipeColorSettings);
        expect(tables).not.toContain(schema.recipeMonoSettings);
        for (const call of db.calls) {
            expect(call.values).toMatchObject({ shadingEffect: 2, exposureCompensation: -3 });
        }
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
        expect(result).toEqual({ written: 0 });
        expect(db.calls).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: FAIL — appliers not exported.

- [ ] **Step 3: Implement the selects and appliers**

Add to `scripts/reprocess-exif-metadata.mjs` (add the drizzle import at the top):

```js
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
```

```js
export async function selectImages(database, schema, { imageIds = [], recipeIds = [] } = {}) {
    const { images, recipeSampleImages } = schema;
    const conditions = [isNotNull(images.finalizedAt), isNotNull(images.preparedObjectKey)];
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
            finalizedAt: images.finalizedAt
        })
        .from(recipeSampleImages)
        .innerJoin(images, eq(images.id, recipeSampleImages.imageId));

    return conditions.length > 0 ? await query.where(and(...conditions)) : await query;
}

export async function applyImageUpdates(database, schema, cameraUpdates, { apply }) {
    if (!apply) return { written: 0 };
    const { images } = schema;
    let written = 0;
    for (const update of cameraUpdates) {
        await database
            .update(images)
            .set({ ...update.after })
            .where(eq(images.id, update.imageId));
        written += 1;
    }
    return { written };
}

export async function applyRecipeUpdates(database, schema, shadingExposureUpdates, { apply }) {
    if (!apply) return { written: 0 };
    const { recipes, recipeColorSettings, recipeMonoSettings } = schema;
    let written = 0;
    for (const update of shadingExposureUpdates) {
        const values = {
            shadingEffect: update.after.shadingEffect,
            exposureCompensation: update.after.exposureCompensation
        };
        await database
            .update(recipes)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(recipes.id, update.recipeId));

        const settingsTable = update.type === 'MONO' ? recipeMonoSettings : recipeColorSettings;
        await database
            .update(settingsTable)
            .set(values)
            .where(eq(settingsTable.recipeId, update.recipeId));

        written += 1;
    }
    return { written };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reprocess-exif-metadata.mjs tests/reprocess-exif-metadata.test.js
git commit -m "feat: add DB selects and write appliers for EXIF reprocess"
```

---

## Task 8: Orchestration, report, and `main`

Wire the phases together in `run`, emit the JSON report and stdout summary, add `main`, the npm script, and the gitignore entry.

**Files:**
- Modify: `scripts/reprocess-exif-metadata.mjs`
- Modify: `.gitignore`
- Modify: `package.json`
- Test: `tests/reprocess-exif-metadata.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces:
  - `run({ database, schema, paths, args, deps, now }): Promise<Report>` where `Report` is
    `{ startedAt, finishedAt, applied, counts, cameraUpdates, nulledFields, shadingExposureUpdates, flaggedMismatch, sourceFallback, skippedNoSource, failures }`.
    `run` selects rows, fetches exif for every relevant image (recording each outcome via `appendProgress`), builds both plans, applies writes when `args.apply`, writes `paths.reportFile`, and returns the report.
  - `formatSummary(report): string` — the human-readable block printed to stdout.
  - `main(): Promise<void>` — resolves production deps, runs, prints the summary, calls exiftool `dispose()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/reprocess-exif-metadata.test.js`:

```js
import { readFile as readFileFs } from 'node:fs/promises';
import { run, formatSummary } from '../scripts/reprocess-exif-metadata.mjs';
import { cachePaths as cp, ensureCacheDirs as ecd } from '../lib/exif-reprocess-cache.js';
import { readFileSync } from 'node:fs';
import { computeRecipeFingerprint as crfp } from '../lib/recipeFingerprint.js';
import { parseRecipeSettingsFromExif as prs } from '../lib/exifparse.js';

const RAW = readFileSync(
    new URL('../openspec/changes/monochrome-profiles/sample-exif/P4070386.JPG.txt', import.meta.url),
    'utf8'
);

describe('run', () => {
    let base;
    let paths;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), 'exif-run-'));
        paths = cp(base);
        await ecd(paths);
    });

    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    function fixtures() {
        const parsed = prs(RAW);
        const schema = {
            images: { __t: 'images', id: { name: 'id' }, finalizedAt: {}, preparedObjectKey: {} },
            recipes: { __t: 'recipes', id: { name: 'id' } },
            recipeColorSettings: { __t: 'rcs', recipeId: {} },
            recipeMonoSettings: { __t: 'rms', recipeId: {} },
            recipeSampleImages: { __t: 'rsi' }
        };
        const dbCalls = [];
        const database = {
            update: (table) => ({ set: (values) => ({ where: (cond) => { dbCalls.push({ table, values }); return Promise.resolve([]); } }) })
        };
        const deps = {
            selectImages: async () => ([
                { id: 1, uuid: 'i1', preparedObjectKey: 'k/i1.jpg', camera: null, lens: null, shutterSpeed: null, aperture: null, focalLength: null, iso: null }
            ]),
            selectRecipeRows: async () => ([
                { id: 90, slug: 'a_r', type: parsed.recipeType, recipeFingerprint: crfp(parsed), shadingEffect: 0, exposureCompensation: 0 }
            ]),
            selectSampleImageRows: async () => ([
                { recipeId: 90, imageId: 1, uuid: 'i1', isPrimary: true, createdAt: '2026-01-01T00:00:00Z', preparedObjectKey: 'k/i1.jpg', finalizedAt: '2026-01-02T00:00:00Z' }
            ]),
            getObject: async () => ({ value: Buffer.from('bytes') }),
            readBody: async (r) => r.value,
            parseMetadata: async () => ({ success: true, data: RAW }),
            storageClient: {}, namespaceName: 'ns', bucketName: 'orig',
            exiftoolArgs: ['-Model']
        };
        return { schema, database, deps, dbCalls };
    }

    it('dry run: builds plans, writes a report, touches no DB rows', async () => {
        const { schema, database, deps, dbCalls } = fixtures();
        const report = await run({
            database, schema, paths,
            args: { apply: false, force: false, imageIds: [], recipeIds: [] },
            deps, now: () => new Date('2026-08-27T00:00:00Z')
        });

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
        const { schema, database, deps, dbCalls } = fixtures();
        const report = await run({
            database, schema, paths,
            args: { apply: true, force: false, imageIds: [], recipeIds: [] },
            deps, now: () => new Date('2026-08-27T00:00:00Z')
        });
        expect(report.applied).toBe(true);
        // 1 image update + 1 recipes mirror + 1 mono settings table = 3
        expect(dbCalls).toHaveLength(3);
    });

    it('formatSummary mentions the flagged and fallback buckets', () => {
        const summary = formatSummary({
            counts: { imagesScanned: 1, recipesScanned: 1 },
            cameraUpdates: [], nulledFields: [], shadingExposureUpdates: [],
            flaggedMismatch: [{ recipeId: 1, slug: 's' }], sourceFallback: [], skippedNoSource: [], failures: []
        });
        expect(summary).toMatch(/flaggedMismatch: 1/);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: FAIL — `run`/`formatSummary` not exported.

- [ ] **Step 3: Implement `run`, `formatSummary`, and `main`**

Add to `scripts/reprocess-exif-metadata.mjs`:

```js
import { writeFile as writeFileFs } from 'node:fs/promises';

import { buildImagePlan, buildRecipePlan } from '../lib/exif-reprocess.js';

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
            finalizedAt: row.finalizedAt
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

    const images = await selectImagesFn(database, schema, { imageIds: args.imageIds, recipeIds: args.recipeIds });
    const recipeRows = await selectRecipeRowsFn(database, schema, { recipeIds: args.recipeIds });
    const sampleRows = await selectSampleImageRowsFn(database, schema, { recipeIds: args.recipeIds });
    const sampleImagesByRecipeId = groupSampleImages(sampleRows);

    // Every image we may need exif for: the scanned images plus any sample
    // image backing a recipe (dedup by id).
    const needExif = new Map();
    for (const image of images) needExif.set(image.id, image);
    for (const list of sampleImagesByRecipeId.values()) {
        for (const sample of list) {
            if (!needExif.has(sample.imageId)) {
                needExif.set(sample.imageId, {
                    id: sample.imageId,
                    uuid: sample.uuid,
                    preparedObjectKey: sample.preparedObjectKey
                });
            }
        }
    }

    const rawByImageId = new Map();
    const failures = [];
    let fetched = 0;
    let cacheHits = 0;

    for (const image of needExif.values()) {
        if (!image.preparedObjectKey) continue;
        const outcome = await fetchExifText({ image, paths, progress, force: args.force, deps });
        if (outcome.source === 'cache') cacheHits += 1;
        if (outcome.source === 'fetch' && outcome.status === 'ok') fetched += 1;

        if (outcome.status === 'ok' && outcome.raw != null) {
            rawByImageId.set(image.id, outcome.raw);
        } else {
            failures.push({ kind: 'fetch', id: image.id, uuid: image.uuid, status: outcome.status });
        }

        if (outcome.source !== 'cache') {
            await appendProgress(paths, { uuid: image.uuid, imageId: image.id, status: outcome.status });
        }
    }

    const imagePlan = buildImagePlan(images, rawByImageId);
    const recipePlan = buildRecipePlan(recipeRows, sampleImagesByRecipeId, rawByImageId);

    let imageWrites = { written: 0 };
    let recipeWrites = { written: 0 };
    try {
        imageWrites = await applyImageUpdates(database, schema, imagePlan.cameraUpdates, { apply: args.apply });
        recipeWrites = await applyRecipeUpdates(database, schema, recipePlan.shadingExposureUpdates, { apply: args.apply });
    } catch (err) {
        failures.push({ kind: 'write', error: err?.message ?? String(err) });
    }

    const report = {
        startedAt,
        finishedAt: now().toISOString(),
        applied: Boolean(args.apply),
        counts: {
            imagesScanned: images.length,
            recipesScanned: recipeRows.length,
            exifFetched: fetched,
            exifCacheHits: cacheHits,
            cameraUpdates: imagePlan.cameraUpdates.length,
            shadingExposureUpdates: recipePlan.shadingExposureUpdates.length,
            flaggedMismatch: recipePlan.flaggedMismatch.length,
            imageRowsWritten: imageWrites.written,
            recipesWritten: recipeWrites.written,
            failures: failures.length
        },
        cameraUpdates: imagePlan.cameraUpdates,
        nulledFields: imagePlan.nulledFields,
        shadingExposureUpdates: recipePlan.shadingExposureUpdates,
        flaggedMismatch: recipePlan.flaggedMismatch,
        sourceFallback: recipePlan.sourceFallback,
        skippedNoSource: recipePlan.skippedNoSource.concat(
            imagePlan.skippedNoExif.map((s) => ({ imageId: s.imageId, slug: null, reason: 'image_exif_unavailable' }))
        ),
        failures
    };

    await writeFileFs(paths.reportFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
}

export function formatSummary(report) {
    const c = report.counts ?? {};
    const lines = [
        report.applied ? 'MODE: APPLY (writes performed)' : 'MODE: DRY RUN (no writes)',
        `images scanned: ${c.imagesScanned ?? 0}`,
        `recipes scanned: ${c.recipesScanned ?? 0}`,
        `camera updates: ${report.cameraUpdates.length}`,
        `  nulled fields (review): ${report.nulledFields.length}`,
        `shading/exposure updates: ${report.shadingExposureUpdates.length}`,
        `flaggedMismatch: ${report.flaggedMismatch.length}`,
        `sourceFallback: ${report.sourceFallback.length}`,
        `skippedNoSource: ${report.skippedNoSource.length}`,
        `failures: ${report.failures.length}`
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
```

- [ ] **Step 4: Add the gitignore entry**

Append to `.gitignore` under the `# debug` section:

```
# EXIF reprocess working dir
/.exif-reprocess/
```

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, after `"image:rerun-resize"`:

```json
    "image:reprocess-exif": "node --env-file=.env.local --import tsx/esm scripts/reprocess-exif-metadata.mjs",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/reprocess-exif-metadata.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/reprocess-exif-metadata.mjs tests/reprocess-exif-metadata.test.js .gitignore package.json
git commit -m "feat: orchestrate EXIF reprocess run with report and CLI entrypoint"
```

---

## Task 9: End-to-end integration test with real exiftool + spec status

One test that drives `fetchExifText` through the real WASM exiftool binary against a bundled sample JPEG, proving the `-Model` fix produces a camera model. Then mark the spec implemented.

**Files:**
- Create: `tests/reprocess-exif-metadata-integration.test.js`
- Modify: `docs/superpowers/specs/2026-08-27-reprocess-exif-metadata-design.md` (status line)

**Interfaces:**
- Consumes: `fetchExifText` (Task 6); `cachePaths`/`ensureCacheDirs` (Task 5); real `parseMetadata`/`dispose` from `@uswriting/exiftool`; `RECIPE_EXIFTOOL_ARGS`, `parseCameraMetadataFromExif` from `lib/exifparse.js`.

- [ ] **Step 1: Write the test**

Create `tests/reprocess-exif-metadata-integration.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/reprocess-exif-metadata-integration.test.js`
Expected: PASS. (First run downloads the WASM binary; may take longer.)

- [ ] **Step 3: Update the spec status**

In `docs/superpowers/specs/2026-08-27-reprocess-exif-metadata-design.md`, change:

```markdown
**Status:** Approved design, pending implementation plan
```

to:

```markdown
**Status:** Implemented — see docs/superpowers/plans/2026-08-27-reprocess-exif-metadata.md
```

- [ ] **Step 4: Run the full suite and linter one last time**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/reprocess-exif-metadata-integration.test.js docs/superpowers/specs/2026-08-27-reprocess-exif-metadata-design.md
git commit -m "test: end-to-end EXIF reprocess fetch through real exiftool"
```

---

## Post-review amendments (applied after Task 9)

The whole-branch review changed several behaviors from the Task 7/8 code blocks
above. The shipped code is authoritative; these are the deltas.

- **Per-row write isolation.** `applyImageUpdates` / `applyRecipeUpdates` catch
  per row and return `{ written, failures }`. `run` merges both `failures`
  arrays into the report and no longer wraps the two appliers in one
  phase-level `try`. A write failure entry is
  `{ kind: 'write', entity: 'image' | 'recipe', id, error }`.
- **Settings table first, and verified.** `applyRecipeUpdates` writes the
  type's settings table before the `recipes` legacy mirror (matching
  `app/recipes/[id]/actions.js`, and because `normalizeRecipeRow` lets the
  settings table win). The settings update uses
  `.returning({ recipeId: … })`; an empty result means the recipe has no
  settings row — it is reported as `settings_row_missing` and is NOT counted in
  `recipesWritten`. The mirror is still written, since with no settings row it
  is the only value `normalizeRecipeRow` can fall back to.
- **`--image` scopes Phase 3.** New `selectRecipeIdsForImages(database, schema,
  { imageIds })` maps the given image ids to the recipes that use them; `run`
  unions that with `args.recipeIds` and passes the result to `selectRecipeRows`
  / `selectSampleImageRows`. When `--image` is given and no recipe uses those
  images, Phase 3 is skipped rather than falling through to the whole table.
- **`needExif` seeding.** Sample rows are filtered with the exported
  `isUsableSampleImage` (`finalizedAt != null && preparedObjectKey`) — the same
  predicate `pickSourceImage` uses — so non-finalized rows no longer produce
  spurious `download_failed` failures.
- **`--force` bypasses the raw cache** as well as the progress checkpoint
  (fresh results are still written to the cache).
- **No progress line for a checkpoint skip.** `run` appends to
  `progress.jsonl` only when `outcome.source !== 'cache' && outcome.status !==
  'skipped_prior_failure'`, so a repeated skip cannot overwrite the original
  `download_failed` / `parse_failed` reason under `loadProgress`'s last-wins
  rule.
- **`formatSummary`** guards every bucket deref (`(bucket ?? []).length`) and
  prints a `skippedImages` line.

Final `report.json` shape:

```jsonc
{
  "startedAt": "…", "finishedAt": "…", "applied": false,
  "counts": {
    "imagesScanned", "recipesScanned", "exifFetched", "exifCacheHits",
    "cameraUpdates", "shadingExposureUpdates", "flaggedMismatch",
    "imageRowsWritten", "recipesWritten",
    "skippedRecipes", "skippedImages", "failures"
  },
  "cameraUpdates":          [ { "imageId", "uuid", "before": {…}, "after": {…} } ],
  "nulledFields":           [ { "imageId", "uuid", "field", "before" } ],
  "shadingExposureUpdates": [ { "recipeId", "slug", "type", "sourceImageId",
                                "before": {…}, "after": {…} } ],
  "flaggedMismatch":        [ { "recipeId", "slug", "sourceImageId",
                                "storedType", "freshType", "stored": {…}, "fresh": {…} } ],
  "sourceFallback":         [ { "recipeId", "slug", "usedImageId" } ],
  "skippedNoSource":        [ { "recipeId", "slug", "reason" } ],
  "skippedImages":          [ { "imageId", "uuid", "reason": "image_exif_unavailable" } ],
  "failures":               [ { "kind": "fetch", "id", "uuid", "status" },
                              { "kind": "write", "entity", "id", "error" } ]
}
```

`skippedNoSource` (recipe-level) and `skippedImages` (image-level) are separate
buckets — they have different shapes and call for different follow-up.

---

## Manual run procedure (after the plan is implemented)

The DB select and write layer has **no executed coverage** — the unit tests
fake `database`. The scoped single-recipe apply in steps 2–5 is the first and
only real exercise of it, so do not skip ahead to an unscoped run.

1. Ensure `.env.local` has `NETLIFY_DATABASE_URL` and the `OCI_IMAGES_*` vars.
2. **Scoped dry run first:** `npm run image:reprocess-exif -- --recipe <one-known-id>`
3. Inspect `./.exif-reprocess/report.json` for that one recipe — check
   `cameraUpdates`, `shadingExposureUpdates`, `flaggedMismatch`, `failures`
   and confirm the values are what you expect for that recipe.
4. **Scoped apply:** `npm run image:reprocess-exif -- --recipe <one-known-id> --apply`
5. Verify THAT recipe in the UI (shading effect + exposure compensation on the
   recipe page, camera/lens/exposure under its sample image). Only proceed once
   this looks right.
6. Full dry run: `npm run image:reprocess-exif`
7. Review the whole report — especially `nulledFields`, `flaggedMismatch`,
   `sourceFallback`, `skippedNoSource`, `skippedImages`, and `failures`.
8. Spot-check a few `flaggedMismatch` recipes by hand; decide separately whether
   any need a fingerprint/settings correction (out of scope for this script).
9. Apply: `npm run image:reprocess-exif -- --apply`
10. Re-run the dry run; confirm `cameraUpdates` / `shadingExposureUpdates` are
    now near-empty (only genuine mismatches remain).
11. Keep `./.exif-reprocess/` until the applied state is verified — the raw
    cache, `progress.jsonl`, and `report.json` are the only audit trail of what
    was written. Delete it after that.

### Notes for the real run

- **`updated_at` churn.** `--apply` bumps `recipes.updated_at` on every recipe
  it touches (spec-mandated: "always set `updated_at`"). The only consumer that
  orders on it is the privacy export listing in `lib/privacy.js`; no public
  sort or cache key uses it (`lib/recipe-sort.js` orders on `created_at`,
  save count, and names), so a mass bump is cosmetic.
- **Cache revalidation.** The script is a plain local Node process, so it
  cannot call `revalidatePublicRecipeCatalog()` (`lib/public-recipe-catalog-cache.js`,
  which needs the Next.js `revalidateTag` runtime). Effects after a large
  `--apply`:
  - Recipe detail pages (`app/recipes/[id]/page.jsx`) query the DB per request
    and are dynamic — they show the new values immediately.
  - The public catalog is `unstable_cache`d under the `public-recipe-catalog`
    tag with `PUBLIC_RECIPE_CATALOG_CACHE_SECONDS` = 24h
    (`lib/public-recipe-catalog.js`, `app/recipes/search/route.js`,
    `app/sitemap.js`). Those entries keep the old shading/exposure values until
    the 24h window lapses, something in-app calls
    `revalidatePublicRecipeCatalog()` (any recipe edit / upload / profile
    action does), or the site is redeployed.
- **`--image <id>` scoping.** `--image` narrows the recipe phase too: only
  recipes whose sample images are in the given set (unioned with any
  `--recipe` ids) are processed. If those images back no recipe, the recipe
  phase is skipped entirely.
- **`--force`** bypasses both the progress checkpoint and the on-disk raw
  cache, so every image is re-downloaded and re-parsed. Fresh results are still
  written back to the cache.

---

## Post-completion amendments (after the first production run)

The first `--apply` against production surfaced two gaps; both were fixed and
re-reviewed. The shipped code is authoritative.

- **Scope expanded to legacy images** (commit `c8985ee`). The original
  `finalized_at IS NOT NULL` filter excluded ~970 legacy-imported sample and
  comparison images that have originals in the bucket and parseable EXIF but
  were created by import scripts that never set `finalized_at`. `selectImages`
  and `isUsableSampleImage` now gate on
  `prepared_object_key IS NOT NULL AND (finalized_at IS NOT NULL OR small_url IS NOT NULL)`
  — "finalized, or a fully-migrated legacy image with published renditions."
  Images with only a legacy `full_size_url` and no `prepared_object_key` (~34)
  stay out of scope.
- **Periodic WASM disposal** (commits `c7d4aaf`, `c98cdb1`). A bulk run of
  hundreds of large JPEGs aborted with `memory access out of bounds`:
  `@uswriting/exiftool` reuses one WASM instance whose linear memory only
  grows. `run` now calls `dispose()` every `RECIPE_EXIF_DISPOSE_EVERY` (default
  50, clamped to a positive integer) WASM parses — cache hits and download
  failures don't count — rebuilding the instance with clean memory. The
  `parseMetadata` call and the in-loop `dispose()` are both wrapped so a
  failure records `parse_failed` / is swallowed rather than aborting before
  `report.json` is written. `report.counts` gains `wasmRuns` / `wasmDisposes`.

First production `--apply` outcome: 833 images scanned, **731 image rows
written** (0 write failures), 0 recipe writes (settings already correct), 11
`flaggedMismatch` (9 are IsaacBD's synthetic film-sim recipes whose sample
photos carry no matching OM profile — expected, not written), 17 images with no
readable EXIF (legacy `.png` exports / stripped JPEGs). Verified: legacy recipe
pages now render the sample EXIF line.

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
| --- | --- |
| Re-download originals from `OCI_IMAGES_ORIGINAL_BUCKET` by `prepared_object_key` | 4 (`readObjectStorageBodyToBuffer`), 6 (`fetchExifText`), 8 (`main` deps) |
| Re-run WASM exiftool with `RECIPE_EXIFTOOL_ARGS` | 6, 9 |
| Per-image camera metadata overwrite, flag non-null→null | 2 (`diffCameraMetadata`), 3 (`buildImagePlan`), 7 (`applyImageUpdates`) |
| Per-recipe shading/exposure to settings table + legacy mirror | 3 (`buildRecipePlan`), 7 (`applyRecipeUpdates`) |
| Primary sample image, fallback to earliest, skip if none | 3 (`pickSourceImage`, `buildRecipePlan`) |
| Fingerprint read-only match check; mismatch → flag & skip | 2 (`classifyRecipe`), 3 (`buildRecipePlan`) |
| Type flip folded into mismatch | 2 (`classifyRecipe` type check), test in Task 2 |
| No fingerprint writes anywhere | Confirmed: no task calls a fingerprint setter; `applyRecipeUpdates` writes only `shadingEffect`/`exposureCompensation` |
| `null → 0` coercion for NOT NULL columns | 2 (`classifyRecipe` payload), tests in Task 2/3 |
| `--dry-run` default, `--apply` writes everything | 6 (`parseArgs`), 7 (appliers gated), 8 (`run`) |
| `--force`, `--image`, `--recipe` filters | 6 (`parseArgs`), 7 (selects), 8 (`run`) |
| Disk cache `raw/<uuid>.txt`, resumable via `progress.jsonl` | 5, 6 (`fetchExifText`), 8 (`run` appends progress) |
| `report.json` with all buckets + stdout summary | 8 (`run`, `formatSummary`) |
| `.exif-reprocess/` gitignored | 8 |
| Shared `toStoredCameraMetadataText` (no drift with upload path) | 1 |
| Serial processing (no bounded concurrency) | 8 (`run` loop is sequential) |

No gaps found.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step has real code. Error handling is concrete (`download_failed` / `parse_failed` / `skipped_prior_failure` statuses, `failures` bucket).

**3. Type consistency:**
- `SampleImage` shape (`imageId`, `uuid`, `isPrimary`, `createdAt`, `preparedObjectKey`, `finalizedAt`) is identical in `pickSourceImage` (Task 3), `groupSampleImages` (Task 8), and `selectSampleImageRows` (Task 7).
- `cameraUpdates` entry (`imageId`, `uuid`, `before`, `after`) produced by `buildImagePlan` (Task 3), consumed by `applyImageUpdates` (Task 7) which reads `.after` and `.imageId`. Consistent.
- `shadingExposureUpdates` entry (`recipeId`, `slug`, `type`, `sourceImageId`, `before`, `after`) produced by `buildRecipePlan` (Task 3), consumed by `applyRecipeUpdates` (Task 7) reading `.after`, `.type`, `.recipeId`. Consistent.
- `classifyRecipe` returns `result: 'match' | 'mismatch'` — used with those exact strings in `buildRecipePlan` (Task 3) and tests (Task 2).
- `fetchExifText` return `{ raw, source, status }` with `source: 'cache' | 'fetch' | 'skipped'` — matched in `run` (Task 8) and tests (Task 6).
- `cachePaths` returns `{ root, rawDir, progressFile, reportFile }` — used consistently in Tasks 5, 6, 8, 9.

No inconsistencies found.
