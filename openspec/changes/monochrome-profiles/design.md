## Context

The current app has a single `recipes` table that mixes shared recipe metadata with color-only settings fields (`yellow` through `yellowGreen`, tone sliders, white balance, and fingerprint columns). Upload validation in `app/upload/actions.js` currently requires `Color Profile Settings` and `Tone Level`, `lib/exifparse.js` only parses the color profile payload, and all recipe rendering assumes a saturation wheel plus the current slider set.

The draft notes and sample EXIF under `openspec/changes/monochrome-profiles/sample-exif/` show that monochrome profiles use different maker-note tags such as `Picture Mode`, `Monochrome Profile Settings`, `Film Grain Effect`, `Monochrome Vignetting`, and `Monochrome Color`. Treating those uploads as if they were color recipes would either fail validation or silently misrepresent the recipe.

## Goals / Non-Goals

**Goals:**
- Support monochrome recipes as first-class uploads and recipe records
- Preserve current color recipe behavior and existing URLs
- Make dedupe and near-match logic type-aware so color and monochrome recipes never collide
- Render monochrome recipes with settings that match their actual camera controls
- Let users browse mixed recipe libraries and filter by `COLOR` or `MONO`

**Non-Goals:**
- Reworking unrelated recipe features such as saved recipes, sample galleries, or camera mode assignments
- Inventing a monochrome `.oes` export format without validated OM Workspace/camera behavior
- Redesigning the authoring flow beyond the upload, browse, and recipe-detail surfaces needed for monochrome support

## Decisions

### 1. Keep shared recipe metadata on `recipes`, move type-specific settings into child tables

**Decision:** Add `recipes.type` with values `COLOR` and `MONO`, and create `recipe_color_settings` and `recipe_mono_settings` tables keyed by `recipe_id UNIQUE REFERENCES recipes(id)`.

**Rationale:** The current `recipes` row mixes two concerns: shared identity/content metadata and concrete camera settings. Splitting settings into child tables keeps the base recipe model stable while allowing each recipe type to have its own required fields, constraints, and fingerprints. Using child tables keyed by `recipe_id` is simpler than nullable FK columns on `recipes` because inserts, deletes, and backfills can follow the natural parent-then-child order without circular references.

**Alternative considered:** Add `recipe_color_settings_fk` and `recipe_mono_settings_fk` columns on `recipes`. This matches the rough draft, but it introduces nullable mutual exclusivity on the parent row and makes backfills and writes more awkward than a single parent-to-child relation.

### 2. Backfill all existing recipe settings into `recipe_color_settings`

**Decision:** Existing recipes become `COLOR` recipes during migration, and every current settings/fingerprint column moves into `recipe_color_settings`.

**Rationale:** This avoids a hybrid model where legacy color recipes still read from `recipes` while new monochrome recipes read from child tables. A clean split keeps query logic coherent and prevents future features from having to support two storage shapes indefinitely.

**Alternative considered:** Leave color fields on `recipes` and add only a mono table. That lowers migration cost in the short term, but it permanently bakes color-specific assumptions into the core recipe model and weakens the value of adding a real recipe type.

### 3. Detect recipe type from EXIF before validation or dedupe

**Decision:** Upload parsing will classify a recipe as `MONO` when monochrome-specific maker-note fields are present, especially `Monochrome Profile Settings` and monochrome `Picture Mode` values; otherwise it follows the existing color path.

**Rationale:** Type must be known before validation, fingerprint generation, duplicate checks, and storage. Classification from EXIF is the only reliable source at upload time and lets the rest of the pipeline branch early and consistently.

**Alternative considered:** Ask the user to pick the recipe type manually. That adds friction, and a wrong choice would lead to incorrect parsing or storage for data the EXIF already identifies.

### 4. Fingerprints remain multi-level, but are computed within each recipe type

**Decision:** Monochrome recipes will get an exact fingerprint plus partial fingerprints analogous to the current color pipeline, but each fingerprint is computed only from fields relevant to monochrome settings. Matching logic will always scope candidates by `recipes.type`.

**Rationale:** The upload flow already depends on layered matching rather than a single exact hash. Monochrome support needs the same shape so the existing duplicate-warning UX can be preserved. Type-scoping prevents false matches between unrelated color and monochrome recipes that happen to share tone values or other overlapping controls.

**Alternative considered:** Reuse the current color fingerprint fields for monochrome by leaving missing color controls at zero. That would produce misleading collisions and hide the semantic differences between color-wheel recipes and monochrome-filter recipes.

### 5. Monochrome recipes get their own presentation model, while reusing the existing shared settings widgets

**Decision:** Recipe reads will hydrate a normalized view model with common metadata plus a type-specific settings payload. UI components will branch on recipe type so monochrome recipes render Mono recipe settings for color filter, film grain, and film hue, while continuing to use the existing `RecipeSettings` subcomponents for shared tone-curve, white-balance, and slider controls. Monochrome vignette strength will be presented through the shared `Shading Effect` control area rather than as a separate monochrome-only row, monochrome profile labels will not be shown, monochrome filter labels will drop the redundant `Filter` suffix, and filter amount will only appear when a color filter is active.

**Rationale:** The current card/detail layout is informative for color recipes because it mirrors camera controls. Reusing the saturation wheel for monochrome recipes would be visually wrong and would imply settings that do not exist, but replacing the shared tone-curve, white-balance, and slider widgets would create unnecessary parallel UI for controls the app already presents well. Presenting monochrome vignette through the existing `Shading Effect` surface keeps the UI aligned with the underlying camera control without requiring a separate monochrome-only display.

**Alternative considered:** Continue rendering the shared sliders only and omit the rest. That would technically display something, but it would make monochrome recipes look incomplete and would undermine user trust in the parsed data.

### 6. Suppress `.oes` downloads for monochrome recipes until export behavior is validated

**Decision:** The `.oes` download action remains available for color recipes only. Monochrome recipes will omit or disable that action with clear copy indicating that export support is not yet available.

**Rationale:** `lib/oes.js` currently generates color-creator XML from saturation-wheel values and does not model monochrome filter controls. Shipping a guessed export would be worse than withholding the action because it would imply compatibility that has not been validated.

**Alternative considered:** Attempt to map monochrome settings into the existing OES generator immediately. That is plausible, but the repository has no validated sample output or import round-trip proving the mapping is correct.

### 7. Draft: Render monochrome filter color and filter level explicitly

**Status:** Draft scaffold for follow-up detail.

**Decision to fill in:** Define how monochrome filter color and filter level should be rendered in recipe cards, recipe detail pages, and upload preview surfaces.

**Details to fill in:**
- Which surfaces must show the filter rendering
- Whether the rendering is text-only, badge-based, swatch-based, slider-based, or a combination
- How `None` should render
- How filter level should render when a filter is active
- Whether color and level should be combined into one control or shown as separate values
- Any accessibility or contrast requirements for the final visual treatment

**Rationale to fill in:** Capture why this rendering communicates monochrome settings better than the current text-only presentation.

**Alternatives to evaluate:**
- Keep plain text labels only
- Add a color chip or badge next to the filter label
- Show level as a compact bar, dots, or slider-style indicator
- Collapse color and level into a single composed label

## Risks / Trade-offs

- **Large query-surface refactor** -> Nearly every recipe read path currently selects directly from `recipes`. Mitigation: introduce shared recipe-query helpers or normalized selectors before updating the pages/routes individually.
- **Migration mistakes could orphan settings rows** -> Backfill and constraint enforcement must happen in a transaction where possible, with uniqueness checks on `recipe_id` and a follow-up audit query in the rollout plan.
- **Monochrome fingerprint design may need tuning** -> Sample EXIF is limited. Mitigation: keep the partial-fingerprint rules explicit and validate against the sample files in this change before removing old assumptions.
- **UI copy still says "color recipes" in several places** -> Users could get mixed signals after the feature ships. Mitigation: include browse/upload/how-to copy updates in the implementation tasks, not as a follow-up polish item.
- **Filter rendering could imply unsupported precision** -> A more visual filter display could overstate the fidelity of parsed EXIF values. Mitigation: define the visual encoding explicitly before implementation and keep it aligned with the actual stored fields.

## Migration Plan

1. Add `recipes.type` with a temporary default of `COLOR`.
2. Create `recipe_color_settings` and `recipe_mono_settings` with required indexes and uniqueness constraints.
3. Backfill every existing recipe into `recipe_color_settings`, copying current settings and fingerprint columns.
4. Update application reads/writes to use the child tables and normalized recipe view models.
5. Remove obsolete settings columns from `recipes` only after application code no longer reads them.
6. Deploy with a rollback plan that restores code before dropping legacy columns; avoid dropping columns in the same step as the initial backfill if operational risk is high.

## Open Questions

- Which monochrome EXIF fields should participate in the partial fingerprints beyond the exact fingerprint, especially if white balance tags are also present on some files?
- Should monochrome recipes eventually support a distinct export format, or should the product position be "display and share only" for now?
- Do custom mode / camera settings flows need monochrome awareness in a follow-up change, or is browse/upload/detail coverage sufficient for the first release?
- What is the intended visual design for monochrome filter color and filter level, and which recipe surfaces should use it?
