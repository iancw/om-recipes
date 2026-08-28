
# Image EXIF Metadata Display — Design Spec

**Date:** 2026-08-27
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Show camera and exposure details — camera, lens, shutter speed, aperture,
focal length, ISO — alongside sample images uploaded through the site. EXIF
is already parsed client-side during upload (WASM exiftool) for a narrow
recipe-settings tag list, but the general photographic metadata is never
requested and nothing is persisted; the `images` table has had `camera`,
`lens`, and `exif_string` columns sitting empty since the very first
migration, and `SampleGallery.jsx` already has a dormant display slot for
`camera`/`lens`. This closes that gap end-to-end: parse → persist → display.

Tracked informally as an open idea in `IDEAS.md`.

### Scope decisions

1. **Structured fields only, no raw EXIF string.** Store just the six
   specific fields we display; do not request or persist the full raw
   exiftool output. Raw EXIF often carries GPS/location data — narrowing
   what we ever pull from the file to a fixed, named tag list keeps that
   out of the database entirely, rather than relying on not-displaying it
   as the only safeguard. `images.exif_string` stays unused, as it is
   today.
2. **Client-side parsing only (Approach 1 of 3 considered).** Extend the
   existing client-side exiftool call rather than adding a server-side
   authoritative extraction step. A malicious client could in principle
   misreport its own camera metadata, but for a personal recipe-sharing
   site there's little incentive to do so, and a server-side pass would
   double the EXIF-parsing logic and add a dependency for marginal
   benefit. Revisit only if spoofed metadata becomes an actual problem.
3. **No backfill.** Existing images never had EXIF persisted (nothing
   reached the server before this feature), so the new columns are simply
   null for them — same as `camera`/`lens` are today. Only images uploaded
   after this ships get populated.
4. **Single inline display line**, appended to the existing camera/lens
   line in the sample gallery modal, not a separate expandable section —
   this is a small amount of text people will glance at, not dig into.

## Context & constraints (existing system)

- **Stack:** Next.js 16 (App Router), Postgres (Neon) via Drizzle ORM,
  hosted on Netlify. Images stored in OCI Object Storage; an OCI Function
  does async resize after upload.
- **EXIF parsing today:** entirely client-side, via `@uswriting/exiftool`
  (WASM exiftool), invoked once per dropped file in
  `app/upload/RecipeUpload.jsx`. The exact tag list requested is
  `RECIPE_EXIFTOOL_ARGS` in `lib/exifparse.js` — narrowly scoped to
  recipe-settings tags (white balance, tone/contrast/sharpness, film
  grain, monochrome profile, exposure compensation, camera model). No
  ISO, aperture, shutter speed, focal length, or lens tag is requested.
  The raw exiftool text (`result.data`) is parsed by
  `parseRecipeSettingsFromExif()` and then discarded — never sent to the
  server.
- **Server persistence today:** `prepareRecipeUploadAction`
  (`app/upload/actions.js`) inserts a new `images` row but only
  `validExif: true` reaches it from the EXIF parse; `camera`, `lens`, and
  `exif_string` are never set on insert, despite existing as columns since
  `migrations/0000_glorious_dorian_gray.sql`.
- **Display today:** `components/SampleGallery.jsx` (used for both
  `sampleImages` and `comparisonImages` on the recipe detail page) has a
  conditional block rendering `[camera, lens].filter(Boolean).join(' • ')`
  — dormant today because both are always null. The recipe detail page
  query (`app/recipes/[id]/page.jsx`) already selects `camera`/`lens` and
  passes them through `hydrateRecipeImageRecord`.
- **Migrations:** generated via `drizzle-kit generate` from
  `db/schema.ts`, output to `migrations/`. Never hand-edit migration
  files. Claude generates migration files but does not run/apply them —
  the user applies migrations manually. Before generating a new migration,
  check for any other in-flight/queued schema-migration branch and land
  it first, to avoid migration-numbering collisions.

## Data model

Four new nullable `text` columns on the existing `images` table in
`db/schema.ts`, alongside the existing (currently unused) `camera` and
`lens`:

| Column | Drizzle field | Type | Example stored value |
|---|---|---|---|
| `shutter_speed` | `shutterSpeed` | text, nullable | `"1/250"` |
| `aperture` | `aperture` | text, nullable | `"4.0"` |
| `focal_length` | `focalLength` | text, nullable | `"40.0 mm"` |
| `iso` | `iso` | text, nullable | `"200"` |

Values are stored as plain text, holding exiftool's own formatted output
rather than pre-decorated display strings (no `"f/"` or `"ISO "` prefix
baked into the stored value) — display-time code adds that formatting, so
the stored values stay simple and reusable if displayed elsewhere later.

New exiftool tags requested, added to the single per-file call already
made (no additional WASM invocation): `-LensModel -ShutterSpeed -Aperture
-FocalLength -ISO`. (`-CameraModelName` is already requested today and
covers the `camera` field.) Exact tag choice — e.g. `-ShutterSpeed`'s
composite fraction output vs. `-ExposureTime`'s raw rational — gets
verified against real fixture files during implementation, the same way
`openspec/changes/monochrome-profiles/sample-exif/` fixtures were used for
the last EXIF tag-list extension.

## Data flow: parse → thread through upload → persist

1. **`lib/exifparse.js`** — add `parseCameraMetadataFromExif(rawText)`
   alongside the existing `parseRecipeSettingsFromExif(rawText)`. Both run
   against the same `result.data` string from the single exiftool call
   already made per file. Returns `{ camera, lens, shutterSpeed, aperture,
   focalLength, iso }`, each `null` if its tag wasn't present in the file
   — uses the same key:value line-parsing approach already used by the
   recipe-settings parser.
2. **`app/upload/RecipeUpload.jsx`** — alongside the existing
   `parseRecipeSettingsFromExif(result.data)` call, also call
   `parseCameraMetadataFromExif(result.data)` and attach the result
   (`cameraMetadata`) to the same per-file candidate object that already
   carries `recipeSettings`/`validExif`.
3. **`app/upload/RecipeUploadSection.jsx`** — thread `cameraMetadata`
   through alongside the existing `recipeSettings`/`validExif` when a
   candidate is submitted.
4. **`app/upload/actions.js`** — `prepareRecipeUploadAction` accepts
   `cameraMetadata` and writes `camera`, `lens`, `shutterSpeed`,
   `aperture`, `focalLength`, `iso` into the `images` insert.

No new dependencies and no new network round trip — this rides entirely on
the existing per-file EXIF parse and existing insert call.

## Display

Extend the existing conditional block in `SampleGallery.jsx` (currently
camera/lens only) to build one inline line covering all six fields, in
this order: camera, lens, shutter speed, aperture, focal length, ISO —
e.g.:

```
OM-1 • 12-40mm f/2.8 • 1/250s • f/4.0 • 40mm • ISO 200
```

Same `.filter(Boolean).join(' • ')` pattern already used today, so any
missing field (common — phone cameras frequently omit lens/aperture tags)
is silently skipped rather than showing a placeholder or gap. Formatting
applied at render time: shutter speed as `` `${shutterSpeed}s` ``,
aperture as `` `f/${aperture}` ``, ISO as `` `ISO ${iso}` ``; focal length
rendered as exiftool returns it (already includes "mm").

Requires widening the Drizzle select and `hydrateRecipeImageRecord`
passthrough in `app/recipes/[id]/page.jsx` to include the four new
columns, alongside the existing `camera`/`lens` selects — this covers both
`sampleImages` and `comparisonImages` since both render through the same
`SampleGallery` component.

## Edge cases

- **Partial/missing EXIF:** every field is independently nullable; the
  `filter(Boolean)` join degrades gracefully to fewer segments, never a
  blank slot — no special-casing needed for phone photos or images with
  sparse metadata.
- **Parse failures:** `parseCameraMetadataFromExif` follows the same
  non-throwing pattern as the existing recipe-settings parser — a
  WASM/parse failure yields all-null fields rather than blocking the
  upload. `validExif` continues to track overall EXIF-parse success
  separately and is unaffected by this feature.
- **No EXIF at all** (e.g. a screenshot or heavily-processed export):
  all six fields null, the metadata line simply doesn't render — same
  `(activeImage.camera || activeImage.lens)` — style guard, widened to
  check all six fields.
- **No backfill:** confirmed above under scope decisions; existing images
  simply show no metadata line, same as they do today.

## Testing (Vitest)

- `parseCameraMetadataFromExif()` against fixture EXIF text: full data,
  partial data (e.g. phone photo missing lens/aperture), and no-EXIF-data
  cases — extends `tests/exifparse.test.js`, reusing the fixture pattern
  from `openspec/changes/monochrome-profiles/sample-exif/`.
- Manual verification of the `SampleGallery` render via a real sample
  upload in the dev server once implemented, covering: full metadata,
  partial metadata, and an image with no EXIF.

## Out of scope

- Displaying metadata anywhere other than the `SampleGallery` modal (e.g.
  `MySamplesGrid`, `RecipeSampleStrip`/recipe cards) — those are compact
  thumbnail views where this detail doesn't belong.
- Server-side/authoritative EXIF re-extraction (Approach 2, considered
  and rejected above).
- Backfilling metadata for images uploaded before this ships.
- Populating or exposing the raw `exif_string` column.
- GPS/location metadata in any form.
