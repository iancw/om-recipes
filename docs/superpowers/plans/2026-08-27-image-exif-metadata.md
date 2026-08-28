# Image EXIF Metadata Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show camera, lens, shutter speed, aperture, focal length, and ISO alongside sample/comparison images in the recipe detail page's image modal, sourced from EXIF already parsed during upload.

**Architecture:** Extend the single client-side exiftool call already made per uploaded file to also request the six general-metadata tags, parse them with a new pure function alongside the existing recipe-settings parser, carry the result through the existing upload-candidate → prepare-action pipeline into four new `images` columns (plus the two existing, currently-unused `camera`/`lens` columns), then widen the recipe detail page's existing Drizzle select and the `SampleGallery` modal's existing (currently dormant) camera/lens display line to show all six fields.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM / Postgres (Neon), `@uswriting/exiftool` (WASM exiftool, client-side), Vitest.

**Spec:** [docs/superpowers/specs/2026-08-27-image-exif-metadata-design.md](../specs/2026-08-27-image-exif-metadata-design.md)

## Global Constraints

- Structured fields only — never request or store raw/full EXIF text or GPS tags (spec scope decision 1).
- Client-side parsing only, no server-side re-extraction (spec scope decision 2).
- No backfill for images uploaded before this ships (spec scope decision 3).
- Migrations are generated (`npm run db:generate`) but never applied/run by the implementer — the user applies migrations manually. Before generating, check for any other queued/unmerged schema-migration branch to avoid migration-number collisions (run `git log --oneline -5 migrations/` on `main` and compare against this branch's latest migration number).
- Stored field values hold exiftool's own formatted text (e.g. `"1/800"`, `"8.0"`, `"17.0 mm"`, `"320"`) with no display prefixes baked in — prefixes (`f/`, `ISO `, `s`) are added at render time only.

---

### Task 1: Schema — add camera/exposure columns to `images`

**Files:**
- Modify: `db/schema.ts:160-165`
- Create: `migrations/00XX_<generated-name>.sql` (and matching `migrations/meta/00XX_snapshot.json`), via `drizzle-kit generate`

**Interfaces:**
- Produces: four new Drizzle fields on the `images` table — `shutterSpeed`, `aperture`, `focalLength`, `iso` (all `text`, nullable) — plus the pre-existing `camera`/`lens` fields, all of which Task 4 writes on insert and Task 5 selects for display.

- [ ] **Step 1: Add the four new columns to `db/schema.ts`**

In `db/schema.ts`, the `images` table currently reads (lines 160-165):

```ts
        dimensions: text('dimensions'),
        camera: text('camera'),
        lens: text('lens'),
        originalFileSize: integer('original_file_size'),
        exif: text('exif_string'),
        validExif: boolean('valid_exif').default(false).notNull(),
```

Change it to:

```ts
        dimensions: text('dimensions'),
        camera: text('camera'),
        lens: text('lens'),
        shutterSpeed: text('shutter_speed'),
        aperture: text('aperture'),
        focalLength: text('focal_length'),
        iso: text('iso'),
        originalFileSize: integer('original_file_size'),
        exif: text('exif_string'),
        validExif: boolean('valid_exif').default(false).notNull(),
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
npm run db:generate
```

Expected: a new file appears under `migrations/` (Drizzle auto-names it, e.g. `migrations/0025_<adjective>_<noun>.sql`) containing four `ALTER TABLE` statements shaped like:

```sql
ALTER TABLE "images" ADD COLUMN "shutter_speed" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "aperture" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "focal_length" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "iso" text;
```

A matching snapshot JSON is added under `migrations/meta/`. **Do not run `npm run db:migrate` or otherwise apply this migration** — leave it for the user to apply manually.

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (a schema-only change with no behavior change yet; this just guards against an accidental typo breaking existing schema-dependent tests).

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts migrations/
git commit -m "Add shutter_speed, aperture, focal_length, iso columns to images"
```

---

### Task 2: Parse camera/exposure metadata from EXIF

**Files:**
- Modify: `lib/exifparse.js`
- Test: `tests/exifparse.test.js`

**Interfaces:**
- Consumes: nothing new — same raw exiftool text string (`result.data`) already available wherever `parseRecipeSettingsFromExif` is called.
- Produces: `parseCameraMetadataFromExif(exifStr: string) => { camera: string|null, lens: string|null, shutterSpeed: string|null, aperture: string|null, focalLength: string|null, iso: string|null }`, exported from `lib/exifparse.js`. Task 3 calls this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/exifparse.test.js`. First, extend the existing import at the top of the file:

```js
import { parseRecipeSettingsFromExif, parseCameraMetadataFromExif } from '../lib/exifparse.js';
```

Then add a new top-level `describe` block (after the closing of the existing `describe('parseRecipeSettingsFromExif', ...)` block, i.e. after its final `});`):

```js
describe('parseCameraMetadataFromExif', () => {
    it('parses camera, lens, and exposure fields from full fixture EXIF', () => {
        const result = parseCameraMetadataFromExif(loadExifFixture('P4070386.JPG.txt'));
        expect(result.camera).toBe('OM-3');
        expect(result.lens).toBe('OLYMPUS M.17mm F1.8');
        expect(result.shutterSpeed).toBe('1/800');
        expect(result.aperture).toBe('8.0');
        expect(result.focalLength).toBe('17.0 mm');
        expect(result.iso).toBe('320');
    });

    it('leaves fields null when their tags are absent, independent of other present fields', () => {
        const exif = `
Camera Model Name               : OM-1 Mark II
ISO                              : 200
`;
        const result = parseCameraMetadataFromExif(exif);
        expect(result.camera).toBe('OM-1 Mark II');
        expect(result.iso).toBe('200');
        expect(result.lens).toBeNull();
        expect(result.shutterSpeed).toBeNull();
        expect(result.aperture).toBeNull();
        expect(result.focalLength).toBeNull();
    });

    it('returns all nulls when no relevant tags are present', () => {
        const result = parseCameraMetadataFromExif(BASE_EXIF);
        expect(result).toEqual({
            camera: null,
            lens: null,
            shutterSpeed: null,
            aperture: null,
            focalLength: null,
            iso: null
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/exifparse.test.js`
Expected: FAIL — `parseCameraMetadataFromExif is not a function` (or similar import error), since it doesn't exist yet.

- [ ] **Step 3: Implement `parseCameraMetadataFromExif`**

In `lib/exifparse.js`, widen the tag list (currently lines 2-18) — add the five new tags (camera model is already requested):

```js
export const RECIPE_EXIFTOOL_ARGS = [
    '-CameraModelName',
    '-LensModel',
    '-ShutterSpeed',
    '-Aperture',
    '-FocalLength',
    '-ISO',
    '-Software',
    '-PictureMode',
    '-WhiteBalance2',
    '-WhiteBalanceTemperature',
    '-WhiteBalanceBracket',
    '-ColorProfileSettings',
    '-MonochromeProfileSettings',
    '-FilmGrainEffect',
    '-MonochromeColor',
    '-ToneLevel',
    '-SharpnessSetting',
    '-ContrastSetting',
    '-MonochromeVignetting',
    '-ExposureCompensation',
];
```

Then append the new function at the end of the file (after the closing `}` of `parseRecipeSettingsFromExif`):

```js

/**
 * Parse general camera/exposure metadata from exiftool output — the fields
 * shown alongside sample images, independent of recipe-settings parsing.
 * @param {string} exifStr - exiftool output as a string
 * @returns {{camera: string|null, lens: string|null, shutterSpeed: string|null, aperture: string|null, focalLength: string|null, iso: string|null}}
 */
export function parseCameraMetadataFromExif(exifStr) {
    const getValue = (regex) => {
        const m = String(exifStr || '').match(regex);
        return m ? m[1].trim() : '';
    };

    const toTextOrNull = (v) => {
        if (v == null || String(v).trim() === '') return null;
        const s = String(v).trim();
        if (/^n\/a$/i.test(s)) return null;
        return s;
    };

    return {
        camera: toTextOrNull(getValue(/^Camera Model Name\s+:([^\n]+)/m)),
        lens: toTextOrNull(getValue(/^Lens Model\s+:([^\n]+)/m)),
        shutterSpeed: toTextOrNull(getValue(/^Shutter Speed\s+:([^\n]+)/m)),
        aperture: toTextOrNull(getValue(/^Aperture\s+:([^\n]+)/m)),
        focalLength: toTextOrNull(getValue(/^Focal Length\s+:([^\n]+)/m)),
        iso: toTextOrNull(getValue(/^ISO\s+:([^\n]+)/m)),
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/exifparse.test.js`
Expected: PASS (all three new tests, plus every pre-existing test in the file still passing).

- [ ] **Step 5: Commit**

```bash
git add lib/exifparse.js tests/exifparse.test.js
git commit -m "Parse camera and exposure metadata from EXIF"
```

---

### Task 3: Thread camera metadata from the client parse through to the prepare-upload call

**Files:**
- Modify: `app/upload/RecipeUpload.jsx:1-69`
- Modify: `app/upload/submit-upload-section.js:1-12`
- Test: `tests/submit-upload-section.test.js`

**Interfaces:**
- Consumes: `parseCameraMetadataFromExif` from Task 2 (`lib/exifparse.js`).
- Produces: every `file` object reaching `submitUploadSection`/`buildPrepareParameters` carries `file.cameraMetadata` (set in `RecipeUpload.jsx`'s drop handler); `buildPrepareParameters` includes a `cameraMetadata` key in the object it returns, which Task 4's `prepareRecipeUploadAction` reads as `parameters.cameraMetadata`.

Note on test coverage: this codebase's convention (see the existing `buildCandidateId`/`buildRejectionError`/`shouldApplyUploadRequestResult` exports from `RecipeUpload.jsx`) is that only pure, extracted logic gets unit tests — the react-dropzone/WASM-exiftool orchestration inside `onDrop` itself is not unit tested anywhere today (no test file mocks `@uswriting/exiftool`). This task follows that same boundary: the *read side* (does `buildPrepareParameters` correctly pass along `file.cameraMetadata`?) gets a real failing-first test below; the *write side* (does `onDrop` correctly call `parseCameraMetadataFromExif` and attach the result to the file?) is a small, direct wiring change verified by the manual end-to-end check in Task 6, consistent with how this file is tested today.

- [ ] **Step 1: Write the failing test for the read side**

Add to `tests/submit-upload-section.test.js`, as a new `it` inside the existing `describe('submitUploadSection', ...)` block:

```js
    it('passes each file\'s cameraMetadata through to prepare', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });
        const cameraMetadata = {
            camera: 'OM-3',
            lens: 'OLYMPUS M.17mm F1.8',
            shutterSpeed: '1/800',
            aperture: '8.0',
            focalLength: '17.0 mm',
            iso: '320'
        };
        const file = { name: 'first.jpg', type: 'image/jpeg', size: 10, cameraMetadata };

        await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [file]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledWith(
            expect.objectContaining({ cameraMetadata })
        );
    });

    it('passes cameraMetadata as null when the file has none', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });
        const file = { name: 'first.jpg', type: 'image/jpeg', size: 10 };

        await submitUploadSection({
            section: {
                mode: 'attach',
                matchedRecipe: { id: 1, slug: 'recipe-a', uuid: 'uuid-a' },
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [file]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledWith(
            expect.objectContaining({ cameraMetadata: null })
        );
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/submit-upload-section.test.js`
Expected: FAIL — `expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ cameraMetadata }))` fails because `buildPrepareParameters` doesn't include a `cameraMetadata` key at all yet.

- [ ] **Step 3: Implement the read side**

In `app/upload/submit-upload-section.js`, change `buildPrepareParameters` (currently lines 1-12):

```js
function buildPrepareParameters({ file, section, matchedRecipe, mode }) {
    return {
        author: section.form.author,
        name: section.form.name,
        notes: section.form.notes,
        sourceUrl: section.form.sourceUrl,
        imageMeta: { name: file.name, type: file.type, size: file.size },
        recipeSettings: section.recipeSettings,
        mode,
        matchedRecipe
    };
}
```

to:

```js
function buildPrepareParameters({ file, section, matchedRecipe, mode }) {
    return {
        author: section.form.author,
        name: section.form.name,
        notes: section.form.notes,
        sourceUrl: section.form.sourceUrl,
        imageMeta: { name: file.name, type: file.type, size: file.size },
        recipeSettings: section.recipeSettings,
        cameraMetadata: file.cameraMetadata ?? null,
        mode,
        matchedRecipe
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/submit-upload-section.test.js`
Expected: PASS (both new tests, plus every pre-existing test in the file still passing).

- [ ] **Step 5: Implement the write side (attach cameraMetadata at parse time)**

In `app/upload/RecipeUpload.jsx`, update the import (currently line 11):

```js
import { parseRecipeSettingsFromExif, RECIPE_EXIFTOOL_ARGS } from 'lib/exifparse';
```

to:

```js
import { parseRecipeSettingsFromExif, parseCameraMetadataFromExif, RECIPE_EXIFTOOL_ARGS } from 'lib/exifparse';
```

Then update `parseExif` (currently lines 59-69):

```js
  const parseExif = async (file) => {
    const result = await parseMetadata(file, {
      args: RECIPE_EXIFTOOL_ARGS
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Unable to read EXIF metadata');
    }

    return parseRecipeSettingsFromExif(result.data);
  };
```

to:

```js
  const parseExif = async (file) => {
    const result = await parseMetadata(file, {
      args: RECIPE_EXIFTOOL_ARGS
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Unable to read EXIF metadata');
    }

    file.cameraMetadata = parseCameraMetadataFromExif(result.data);

    return parseRecipeSettingsFromExif(result.data);
  };
```

(`file` is the same `File` object passed in from `acceptedFiles` in `onDrop`, and that same reference flows unchanged through `candidates` → `sectionFiles` → `RecipeUploadSection`'s `pendingFiles` → `submitUploadSection`'s `section.files` → `buildPrepareParameters`'s `file` argument, with no cloning at any point — so this expando property survives all the way to Step 3's read site.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no existing test constructs a `File`/file-like object and asserts on its exact own-property shape, so adding `cameraMetadata` as an extra property doesn't break anything.

- [ ] **Step 7: Commit**

```bash
git add app/upload/RecipeUpload.jsx app/upload/submit-upload-section.js tests/submit-upload-section.test.js
git commit -m "Thread parsed camera metadata through to the prepare-upload call"
```

---

### Task 4: Persist camera metadata on the image row

**Files:**
- Modify: `app/upload/actions.js:612`, `app/upload/actions.js:775-789`
- Test: `tests/prepare-recipe-upload.test.js`

**Interfaces:**
- Consumes: `parameters.cameraMetadata` from Task 3 (shape: `{ camera, lens, shutterSpeed, aperture, focalLength, iso }`, each `string|null`, or the whole object may be `null`/absent).
- Produces: the `images` row inserted by `prepareRecipeUploadAction` has `camera`, `lens`, `shutterSpeed`, `aperture`, `focalLength`, `iso` set from `cameraMetadata` (or all `null` if not provided). Task 5 selects these columns for display.

- [ ] **Step 1: Write the failing tests**

Add to `tests/prepare-recipe-upload.test.js`, as new `it` blocks inside the existing `describe('prepareRecipeUploadAction duplicate handling', ...)` block (alongside the other `prepareRecipeUploadAction` tests, e.g. right after the `'stores the image SHA-256 digest when creating upload metadata'` test):

```js
    it('persists camera metadata fields onto the image row when provided', async () => {
        selectResults = [[], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings(),
                cameraMetadata: {
                    camera: 'OM-3',
                    lens: 'OLYMPUS M.17mm F1.8',
                    shutterSpeed: '1/800',
                    aperture: '8.0',
                    focalLength: '17.0 mm',
                    iso: '320'
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBe('OM-3');
        expect(capturedImageValues.lens).toBe('OLYMPUS M.17mm F1.8');
        expect(capturedImageValues.shutterSpeed).toBe('1/800');
        expect(capturedImageValues.aperture).toBe('8.0');
        expect(capturedImageValues.focalLength).toBe('17.0 mm');
        expect(capturedImageValues.iso).toBe('320');
    });

    it('defaults camera metadata fields to null when cameraMetadata is not provided', async () => {
        selectResults = [[], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBeNull();
        expect(capturedImageValues.lens).toBeNull();
        expect(capturedImageValues.shutterSpeed).toBeNull();
        expect(capturedImageValues.aperture).toBeNull();
        expect(capturedImageValues.focalLength).toBeNull();
        expect(capturedImageValues.iso).toBeNull();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/prepare-recipe-upload.test.js`
Expected: FAIL — `capturedImageValues.camera` is `undefined`, not `'OM-3'` (first test) / not `null` (second test), since the insert doesn't set these fields yet.

- [ ] **Step 3: Implement**

In `app/upload/actions.js`, update the parameter destructuring (currently line 612):

```js
        const { author, name, notes, sourceUrl, imageMeta, recipeSettings, mode, matchedRecipe } = parameters ?? {};
```

to:

```js
        const { author, name, notes, sourceUrl, imageMeta, recipeSettings, cameraMetadata, mode, matchedRecipe } = parameters ?? {};
```

Then update the `images` insert (currently lines 775-789):

```js
        const imageRow = await db
            .insert(images)
            .values({
                authorId,
                uuid: imageUuid,
                // set after upload so we can include UUID in the object key
                fullSizeUrl: null,
                // async resize means this may not exist immediately, but URL is deterministic
                smallUrl: null,
                originalFileSize: imageMeta?.size || null,
                validExif: true,
                sha256Hash: imageSha,
                preparedRecipeId: createdRecipeId,
                preparedObjectKey: objectKey
            })
            .returning({ id: images.id });
```

to:

```js
        const imageRow = await db
            .insert(images)
            .values({
                authorId,
                uuid: imageUuid,
                // set after upload so we can include UUID in the object key
                fullSizeUrl: null,
                // async resize means this may not exist immediately, but URL is deterministic
                smallUrl: null,
                originalFileSize: imageMeta?.size || null,
                validExif: true,
                sha256Hash: imageSha,
                preparedRecipeId: createdRecipeId,
                preparedObjectKey: objectKey,
                camera: cameraMetadata?.camera ?? null,
                lens: cameraMetadata?.lens ?? null,
                shutterSpeed: cameraMetadata?.shutterSpeed ?? null,
                aperture: cameraMetadata?.aperture ?? null,
                focalLength: cameraMetadata?.focalLength ?? null,
                iso: cameraMetadata?.iso ?? null
            })
            .returning({ id: images.id });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/prepare-recipe-upload.test.js`
Expected: PASS (both new tests, plus every pre-existing test in the file still passing).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/upload/actions.js tests/prepare-recipe-upload.test.js
git commit -m "Persist camera and exposure metadata on the image row"
```

---

### Task 5: Display camera metadata in the sample image modal

**Files:**
- Modify: `lib/recipe-image-selection.js`
- Modify: `components/SampleGallery.jsx:7-11,395-399`
- Modify: `app/recipes/[id]/page.jsx:65-96`
- Test: `tests/recipe-image-selection.test.js`

**Interfaces:**
- Consumes: `camera`, `lens`, `shutterSpeed`, `aperture`, `focalLength`, `iso` fields selected onto each image record by the widened Drizzle queries in `app/recipes/[id]/page.jsx` (Task 1's columns, Task 4's persisted values).
- Produces: `formatImageMetadataLine(image)` exported from `lib/recipe-image-selection.js`, consumed by `SampleGallery.jsx`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/recipe-image-selection.test.js`. First, extend the existing import at the top of the file to include the new function:

```js
import {
    comparisonImageSelectionValue,
    formatImageMetadataLine,
    getAvailableComparisonImageLabels,
    getImagePreviewUrl,
    getRecipeCardPreviewUrl,
    getRecipeDownloadImage,
    getRecipeDownloadUrl,
    getRecipeModalImageUrl,
    getPrimarySampleImage,
    getRecipePreviewImage,
    getVisibleComparisonImages,
    getVisibleSampleImages,
    SAMPLE_IMAGE_SELECTION
} from '../lib/recipe-image-selection.js';
```

Then add, before the closing `});` of the `describe('recipe image selection helpers', ...)` block:

```js
    it('joins all six metadata fields into one line, formatting shutter speed, aperture, and ISO', () => {
        const line = formatImageMetadataLine({
            camera: 'OM-3',
            lens: '12-40mm f/2.8',
            shutterSpeed: '1/250',
            aperture: '4.0',
            focalLength: '40.0 mm',
            iso: '200'
        });

        expect(line).toBe('OM-3 • 12-40mm f/2.8 • 1/250s • f/4.0 • 40.0 mm • ISO 200');
    });

    it('omits missing fields without leaving gaps', () => {
        const line = formatImageMetadataLine({
            camera: 'iPhone 15 Pro',
            lens: null,
            shutterSpeed: '1/120',
            aperture: null,
            focalLength: '6.86 mm',
            iso: '64'
        });

        expect(line).toBe('iPhone 15 Pro • 1/120s • 6.86 mm • ISO 64');
    });

    it('returns an empty string when no metadata fields are present', () => {
        expect(formatImageMetadataLine({})).toBe('');
        expect(formatImageMetadataLine(null)).toBe('');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/recipe-image-selection.test.js`
Expected: FAIL — `formatImageMetadataLine is not a function`, since it doesn't exist yet.

- [ ] **Step 3: Implement `formatImageMetadataLine`**

In `lib/recipe-image-selection.js`, add the following export right after `formatComparisonImageLabelForDisplay` (which ends with the closing `}` seen at line ~53):

```js

export function formatImageMetadataLine(image) {
    const shutterSpeed = image?.shutterSpeed ? `${image.shutterSpeed}s` : null;
    const aperture = image?.aperture ? `f/${image.aperture}` : null;
    const iso = image?.iso ? `ISO ${image.iso}` : null;

    return [image?.camera, image?.lens, shutterSpeed, aperture, image?.focalLength, iso]
        .filter(Boolean)
        .join(' • ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/recipe-image-selection.test.js`
Expected: PASS (all three new tests, plus every pre-existing test in the file still passing).

- [ ] **Step 5: Wire the formatted line into `SampleGallery.jsx`**

Update the import block (currently lines 7-11):

```js
import {
  formatComparisonImageLabelForDisplay,
  getImagePreviewUrl,
  getRecipeModalImageUrl
} from '../lib/recipe-image-selection';
```

to add `formatImageMetadataLine` to that same import (keep the rest of the import list as-is):

```js
import {
  formatComparisonImageLabelForDisplay,
  formatImageMetadataLine,
  getImagePreviewUrl,
  getRecipeModalImageUrl
} from '../lib/recipe-image-selection';
```

Then replace the existing camera/lens-only block (currently lines 395-399):

```jsx
              {(activeImage.camera || activeImage.lens) && (
                <p>
                  {[activeImage.camera, activeImage.lens].filter(Boolean).join(' • ')}
                </p>
              )}
```

with:

```jsx
              {formatImageMetadataLine(activeImage) && (
                <p>
                  {formatImageMetadataLine(activeImage)}
                </p>
              )}
```

- [ ] **Step 6: Widen the Drizzle selects in the recipe detail page**

In `app/recipes/[id]/page.jsx`, the comparison-images query's `image` select (currently lines 67-77):

```js
                image: {
                    id: images.id,
                    uuid: images.uuid,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens
                }
```

becomes:

```js
                image: {
                    id: images.id,
                    uuid: images.uuid,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens,
                    shutterSpeed: images.shutterSpeed,
                    aperture: images.aperture,
                    focalLength: images.focalLength,
                    iso: images.iso
                }
```

And the sample-images query's `image` select (currently lines 85-96):

```js
                image: {
                    id: images.id,
                    uuid: images.uuid,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens,
                    validExif: images.validExif
                },
```

becomes:

```js
                image: {
                    id: images.id,
                    uuid: images.uuid,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens,
                    shutterSpeed: images.shutterSpeed,
                    aperture: images.aperture,
                    focalLength: images.focalLength,
                    iso: images.iso,
                    validExif: images.validExif
                },
```

(No change needed in `hydrateRecipeImageRecord`, `lib/recipe-image-assets.js` — it spreads `...image` over the selected object, so these new fields pass through automatically.)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/recipe-image-selection.js components/SampleGallery.jsx "app/recipes/[id]/page.jsx" tests/recipe-image-selection.test.js
git commit -m "Display camera and exposure metadata in the sample image modal"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Apply the migration locally**

Ask the user to run (per the manual-migrations constraint, this is not run by the implementer):

```bash
npm run db:migrate
```

- [ ] **Step 2: Start the dev server and upload a real JPG with EXIF**

```bash
netlify dev
```

Drop a straight-out-of-camera JPG from an OM System/Olympus camera (or any JPG with standard EXIF) into the upload page. Confirm:
- No console errors during parsing or submit.
- The upload completes and creates/attaches to a recipe as before.

- [ ] **Step 3: Verify the display**

Open the resulting recipe's detail page, open the sample image in the modal, and confirm the metadata line renders with `•`-separated camera, lens, shutter speed (`.../…s`), aperture (`f/…`), focal length, and ISO (`ISO …`) — with any field the camera didn't report simply omitted, not shown as blank.

- [ ] **Step 4: Verify old images are unaffected**

Open a recipe with sample images uploaded before this change and confirm the modal renders exactly as before — no metadata line, no error — since those rows have `null` in the new columns.

- [ ] **Step 5: Update `IDEAS.md`**

Remove or check off the EXIF-display idea entry (`IDEAS.md:18`) now that it's implemented.

```bash
git add IDEAS.md
git commit -m "Mark EXIF metadata display idea as done"
```
