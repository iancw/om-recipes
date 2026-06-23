## 1. Schema And Migration

- [ ] 1.1 Add `recipes.type` and create `recipe_color_settings` / `recipe_mono_settings` tables with `recipe_id` uniqueness, type-appropriate fields, and fingerprint indexes in `db/schema.ts`
- [ ] 1.2 Generate a migration that backfills all existing recipe settings and fingerprints from `recipes` into `recipe_color_settings`
- [ ] 1.3 Update Drizzle relations and any shared recipe selectors to load the correct child settings row for each recipe type
- [ ] 1.4 Remove legacy direct reads of color-setting columns from `recipes`, and drop those columns in a follow-up migration step once code has switched over

## 2. EXIF Parsing And Fingerprinting

- [ ] 2.1 Extend `lib/exifparse.js` to classify uploads as `COLOR` or `MONO` and parse monochrome-specific maker-note fields from sample EXIF
- [ ] 2.2 Refactor `lib/recipeFingerprint.js` to compute type-aware exact and partial fingerprints for both color and monochrome recipes
- [ ] 2.3 Update upload duplicate checks in `app/upload/actions.js` so fingerprint matching is scoped by recipe type and preserves the current warning/blocking behavior for color uploads
- [ ] 2.4 Add focused tests or fixture-driven verification for monochrome EXIF parsing and fingerprint generation using the sample EXIF files in this change

## 3. Upload And Recipe Writes

- [ ] 3.1 Update `prepareRecipeUploadAction` to validate monochrome uploads correctly and write settings into the proper child table
- [ ] 3.2 Update recipe creation/edit flows to keep fingerprints in sync without assuming color-setting columns live on `recipes`
- [ ] 3.3 Ensure duplicate-match responses and upload preview messaging describe monochrome matches accurately

## 4. Recipe Reads And UI

- [ ] 4.1 Update `/recipes/search` and the homepage search/filter UI to support `COLOR` / `MONO` filtering while returning mixed results by default
- [ ] 4.2 Introduce a type-aware recipe settings presentation model and update recipe cards/detail pages to render Mono recipe settings for color filter, film grain, and film hue instead of the saturation wheel when appropriate, displaying monochrome vignette through the shared `Shading Effect` area rather than a separate monochrome row
- [ ] 4.3 Reuse the existing `RecipeSettings` shared presentations for tone curve, white balance, and other shared sliders when rendering monochrome recipes, rather than creating duplicate mono-only widgets for those controls
- [ ] 4.4 Hide monochrome profile labels from the UI, shorten monochrome filter labels by dropping the redundant `Filter` suffix, and suppress `Filter Amount` when no monochrome color filter is active
- [ ] 4.4a Draft and approve the monochrome filter rendering spec for filter color and filter level presentation across recipe surfaces
- [ ] 4.4b Implement the approved monochrome filter rendering treatment in the relevant recipe UI surfaces
- [ ] 4.4c Add or update tests that lock in the chosen monochrome filter rendering behavior
- [ ] 4.5 Hide or disable `.oes` download actions for monochrome recipes while preserving current color download behavior
- [ ] 4.6 Update site copy on browse/upload/help surfaces that currently refers only to "color recipes"

## 5. Verification

- [ ] 5.1 Manually verify one existing color recipe, one new monochrome upload, and mixed search results after the migration
- [ ] 5.2 Confirm monochrome recipes never match color recipes in duplicate detection and never expose unsupported color-only exports
