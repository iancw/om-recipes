
# Reprocess EXIF Metadata — Design Spec

**Date:** 2026-08-27
**Status:** Implemented — see docs/superpowers/plans/2026-08-27-reprocess-exif-metadata.md
**Author:** Ian Will (with Claude)

## Summary

Three EXIF-parsing fixes landed after image and recipe data was already
persisted, so existing rows carry values the current parser would not
produce:

1. **Camera model.** `RECIPE_EXIFTOOL_ARGS` requested `-CameraModelName`,
   which is only exiftool's *output label* for the `Model` tag, not a real
   tag name. exiftool silently drops unrecognized `-TagName` args, so the
   camera model was never returned and `images.camera` (plus the
   model-derived half of `recipes.source`) was never populated for
   uploads made before commit `3fa683c`.
2. **Shading effect.** The camera stores the Shading Effect slider
   (−5..+5) for both color and monochrome profiles in the maker-note tag
   exiftool labels "Monochrome Vignetting" (Olympus `0x53a`). Parsing for
   it was added in commit `0e07e58`; recipes created earlier have the
   `shading_effect` column at its `0` default.
3. **Exposure compensation.** Normalized parsing into tenths-of-a-stop
   (`smallint`) was added in the same commit; earlier recipes have
   `exposure_compensation` at its `0` default.

There is **no stored raw EXIF** to re-parse — `images.exif_string` has
been dead since the first migration and the upload path never writes it.
Reprocessing therefore means: re-download each original JPEG from OCI
object storage, re-run the same WASM exiftool the browser uses, and
re-parse with the current `lib/exifparse.js`.

This spec covers a one-off maintenance script, run locally by the
maintainer against production infrastructure, in the same manner as
`scripts/rerun-image-resize.mjs` and
`scripts/backfill-recipe-fingerprints.mjs`.

## Scope decisions

1. **Write back two things:**
   - Per-image camera metadata: `images.camera`, `lens`, `shutter_speed`,
     `aperture`, `focal_length`, `iso`.
   - Per-recipe `shading_effect` and `exposure_compensation`, on the
     type-appropriate settings table (`recipe_color_settings` /
     `recipe_mono_settings`) and the legacy mirror columns on `recipes`.
2. **Do not re-sync `recipes.source`.** The `-Model` fix also affects the
   camera-model half of `source`, but `source` is cosmetic, not used for
   matching, and out of scope here. Only `images.camera` gets the
   camera-model correction.
3. **Process every finalized image, every time.** No "stale rows only"
   filter — `0` is a legitimate value for `shading_effect` /
   `exposure_compensation` and a null camera field is not the only symptom
   of the bug. Downloads are cached on disk so re-runs are cheap.
4. **`--dry-run` is the default.** A single `--apply` flag performs all
   writes. There is no separate gate for identity-changing recipe writes.
5. **This script never writes fingerprints or core recipe settings.**
   Every fingerprint function in `lib/recipeFingerprint.js` deliberately
   excludes `shadingEffect` and `exposureCompensation` (confirmed by the
   schema comment at `db/schema.ts` `recipe_fingerprint`), so fixing those
   two fields changes no fingerprint on its own — there is nothing to
   recompute. The stored `recipe_fingerprint` is still read, purely as a
   consistency check: if a recipe's source image re-parses to a *different*
   fingerprint, that recipe is flagged and skipped (Phase 3) rather than
   having anything written from a source that no longer matches it.
   `scripts/backfill-recipe-fingerprints.mjs` already exists for a
   from-current-DB-values fingerprint recompute if one is ever wanted
   independently.

## How EXIF flows today (for context)

`app/upload/RecipeUpload.jsx` runs `@uswriting/exiftool`'s `parseMetadata`
in the browser with `args: RECIPE_EXIFTOOL_ARGS`, then calls
`parseCameraMetadataFromExif` and `parseRecipeSettingsFromExif` from
`lib/exifparse.js`. The parsed objects are sent to the server; the server
never touches exiftool. `parseMetadata` works under Node too — see
`scripts/check-exifparse-fixture.mjs`.

Originals live in `process.env.OCI_IMAGES_ORIGINAL_BUCKET` at the key
stored in `images.prepared_object_key`. `getObject` from
`lib/oci/objectStorage.js` fetches them; the body-draining logic in
`app/upload/actions.js` (`sha256HexFromObjectStorageResponse`) shows how
to turn the OCI response into a `Buffer`.

## Architecture

One script: `scripts/reprocess-exif-metadata.mjs`, plus a pure logic
module `lib/exif-reprocess.js` for the diff/classification decisions so
they can be unit-tested without DB or OCI access.

```
node --env-file=.env.local --import tsx/esm scripts/reprocess-exif-metadata.mjs \
  [--apply] [--force] [--image <id>] [--recipe <id>]
```

Add an npm alias `image:reprocess-exif` mirroring the existing
`image:rerun-resize` / `db:backfill:*` entries.

Flags:

- `--apply` — perform writes. Without it, dry-run: compute and print
  everything, write nothing to the DB.
- `--force` — ignore the progress checkpoint and re-fetch / re-evaluate
  every image.
- `--image <id>` / `--recipe <id>` — restrict processing to one image or
  one recipe, repeatable, for testing. When `--recipe` is given, its
  primary sample image is fetched even if `--image` is also constrained.

Uses the drizzle `db` client (`db/index.ts`) and the `db/schema.ts`
tables, consistent with `backfill-recipe-fingerprints.mjs`.

### Working directory

All transient state lives under `./.exif-reprocess/` (added to
`.gitignore`):

- `raw/<image-uuid>.txt` — cached raw exiftool output (`result.data`).
- `progress.jsonl` — one line per processed image:
  `{"imageId":N,"uuid":"…","status":"ok|download_failed|parse_failed","at":"ISO"}`.
- `report.json` — structured result of the most recent run (overwritten
  each run).

### Phase 1 — fetch & parse every finalized image

1. Select from `images` where `finalized_at is not null` and
   `prepared_object_key is not null`. Apply `--image` / `--recipe`
   restrictions.
2. Skip images already recorded `ok` in `progress.jsonl` unless
   `--force` (they still contribute their cached parse to Phases 2–3).
3. For each remaining image:
   - If `raw/<uuid>.txt` exists, read it.
   - Else `getObject({ client, namespaceName, bucketName: ORIGINAL_BUCKET,
     objectName: prepared_object_key })`, drain to a `Buffer`, wrap in
     `new File([buf], basename, { type: 'image/jpeg' })`, call
     `parseMetadata(file, { args: RECIPE_EXIFTOOL_ARGS })`. On
     `!result.success`, record `parse_failed` and continue. Write
     `result.data` to the cache file.
   - Append a `progress.jsonl` line.
4. Download / parse failures are collected into the report's `failures`
   bucket and do not abort the run. The affected images (Phase 2) and any
   recipe relying on them as the source image (Phase 3) are reported as
   `skipped_no_source`.

Processing is serial. Bounded concurrency was considered and deferred —
keep the first version simple; the disk cache already makes re-runs fast.

### Phase 2 — per-image camera metadata

For each image with a successful parse:

1. `parseCameraMetadataFromExif(raw)` → `{ camera, lens, shutterSpeed,
   aperture, focalLength, iso }`.
2. Sanitize each field with the same rule the upload path uses —
   `toStoredCameraMetadataText` (trim, null on empty, cap at 200 chars).
   This helper moves to `lib/exif-reprocess.js` (or another shared
   module) and `app/upload/actions.js` imports it from there, so the
   script and server cannot drift.
3. Diff the sanitized object against the current row. If any field
   differs, stage an update of all six columns plus `updated_at`.
4. The re-parse is treated as authoritative (full overwrite, including
   setting a field back to null). Any field transitioning **non-null →
   null** is added to the report's `nulled_fields` bucket so the
   maintainer can eyeball those before/after `--apply`.

### Phase 3 — per-recipe shading & exposure

For each recipe (respecting `--recipe`):

1. **Source image:** the sample image flagged `is_primary` in
   `recipe_sample_images`, joined to `images` and filtered to
   `finalized_at is not null and prepared_object_key is not null`. If the
   primary is missing or not a valid source, fall back to the earliest
   (by `images.created_at`) valid sample image and note
   `source_fallback` in the report. If the recipe has no valid sample
   image at all (e.g. JSON-imported recipes), count it as
   `skipped_no_source` and move on.
2. `parseRecipeSettingsFromExif(raw)` on the source image → `fresh`.
3. Compute `computeRecipeFingerprint(fresh)` and compare to the stored
   `recipes.recipe_fingerprint`:

   **Case A — fingerprint matches.** The parser fixes did not disturb this
   recipe's core settings, so the source image still faithfully represents
   the recipe. Write only `shading_effect` and `exposure_compensation`
   (from `fresh.shadingEffect` / `fresh.exposureCompensation`, defaulting
   `null → 0` to satisfy the `notNull` columns) to:
   - the type's settings table (`recipe_color_settings` for
     `recipes.type = 'COLOR'`, else `recipe_mono_settings`), and
   - the legacy mirror columns on `recipes`.

   Set `updated_at`. Added to report bucket `shading_exposure_updates`
   with before/after values.

   **Case B — fingerprint differs.** The source image's core settings no
   longer parse to this recipe's identity — a parser change moved a
   fingerprinted value, or the primary sample image is not actually a
   faithful example of the recipe. Either way, this script does **not**
   touch fingerprints or core settings, and it will not copy
   `shading_effect` / `exposure_compensation` from a source that no longer
   matches. Flag the recipe in report bucket `flagged_mismatch` (recording
   stored vs. fresh values and the stored vs. fresh recipe type) and write
   nothing. These are for the maintainer to resolve by hand.

There are no other guardrails: with no fingerprint or core-settings
writes, recipe-type flips and fingerprint collisions cannot be introduced.
A `fresh.recipeType` that disagrees with `recipes.type` simply falls into
`flagged_mismatch` along with every other Case B recipe.

### Writes

All DB writes happen only under `--apply`, are issued per row (no bulk
statement), and always set `updated_at`. Order: Phase 2 image updates,
then Phase 3 recipe updates. A write failure on one row is caught,
recorded in the report's `failures` bucket, and does not abort the run.

### Report

`./.exif-reprocess/report.json`, always written (dry-run and `--apply`),
shape:

```jsonc
{
  "startedAt": "…", "finishedAt": "…", "applied": false,
  "counts": { "imagesScanned": N, "imagesFetched": N, "cacheHits": N, … },
  "cameraUpdates":        [ { "imageId", "uuid", "before": {…}, "after": {…} } ],
  "nulledFields":         [ { "imageId", "field", "before" } ],
  "shadingExposureUpdates":[ { "recipeId", "slug", "before": {…}, "after": {…} } ],
  "flaggedMismatch":      [ { "recipeId", "slug", "sourceImageId",
                              "storedType", "freshType",
                              "stored": {…}, "fresh": {…} } ],
  "sourceFallback":       [ { "recipeId", "slug", "usedImageId" } ],
  "skippedNoSource":      [ { "recipeId", "slug" } ],
  "failures":             [ { "kind", "id", "error" } ]
}
```

A concise human summary of these counts is also printed to stdout, plus
per-entity diff lines during the run.

## Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `scripts/reprocess-exif-metadata.mjs` | arg parsing, DB selects, OCI fetch, disk cache + checkpoint, applying writes, stdout summary | drizzle `db`, `db/schema.ts`, `lib/oci/objectStorage.js`, `@uswriting/exiftool`, `lib/exifparse.js`, `lib/exif-reprocess.js` |
| `lib/exif-reprocess.js` | pure functions: `toStoredCameraMetadataText`, `diffCameraMetadata(current, fresh)`, `classifyRecipe({ storedType, storedFingerprint, fresh })` → `{ case: 'match'\|'mismatch', payload }` where `payload` (match only) is `{ shadingEffect, exposureCompensation }` | `lib/recipeFingerprint.js` |
| `app/upload/actions.js` | imports `toStoredCameraMetadataText` from the shared module instead of defining it locally | `lib/exif-reprocess.js` |

## Testing

**Unit (`lib/exif-reprocess.js`), with synthetic exiftool text fixtures:**

- `toStoredCameraMetadataText`: trim, empty/sentinel → null, 200-char cap.
- `diffCameraMetadata`: no change → no update; changed field → all six
  staged; non-null → null flagged.
- `classifyRecipe`:
  - matching fingerprint → `match`, payload is exactly
    `{ shadingEffect, exposureCompensation }` with `null → 0`.
  - differing fingerprint → `mismatch`, no payload.
  - `fresh` type differs from `storedType` → `mismatch` (it is one kind of
    fingerprint mismatch, not a separate case).

**Fixtures:** extend `data/samples/` with a small JPEG (or a saved raw
exiftool-output text file) exercising a known shading-effect /
exposure-compensation / camera-model case, alongside the existing
`OM_recipe_1.jpg` used by `check-exifparse-fixture.mjs`.

**Integration:** a `--dry-run` pass against production is the acceptance
check before running `--apply`; the report's `flaggedMismatch` and
`nulledFields` buckets are reviewed by hand first.

## Out of scope

- Recomputing `images.dimensions` or any field not listed in Scope.
- Re-syncing `recipes.source`.
- Persisting raw EXIF (`images.exif_string` stays unused).
- Automatic recipe dedup / merging or type migration.
- Backfilling recipes that have no sample image.
- Bounded-concurrency fetching (deferred; revisit only if a serial run is
  intolerably slow).
