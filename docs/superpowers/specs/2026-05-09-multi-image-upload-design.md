# Multi-Image Grouped Upload Design

Date: 2026-05-09
Issue: `om-recipes-4xl`

## Goal

Allow the upload page to accept multiple JPGs in one drop, detect the recipe settings in each image, group images by exact recipe match, and render one independent recipe section per group. Each section must support either creating a new recipe or attaching all images in that group as community samples to an existing exact-match recipe.

The page should also support a review-only workflow where users can drop files just to see which recipes are present without uploading anything.

## Current State

`app/upload/RecipeUpload.jsx` is built around a single-file state machine:

- one dropped file
- one preview
- one parsed recipe
- one existing-recipe match lookup
- one submit flow
- one redirect-on-success

That structure breaks down for mixed drops containing:

- multiple images from the same recipe
- multiple images from different recipes
- a mix of exact existing recipe matches and brand-new recipes

## User Experience

### Page behavior

The upload page becomes a review surface for a dropped set of JPGs.

After a drop:

1. each file is parsed independently
2. valid files are grouped by exact recipe match
3. one section is rendered per exact-match group
4. invalid files are shown separately with their error state

The page itself does not own shared recipe metadata fields. All editable fields live inside each recipe section so each group is fully independent.

### Recipe section behavior

Each recipe section contains:

- grouped image thumbnails and filenames
- detected recipe settings summary
- `author` input
- `recipe name` input
- `notes` input
- `source URL` input
- existing-recipe match state
- section-local upload status, error, and success messaging
- one section-local submit action

Each section should feel like a self-contained upload unit. A user can review or submit one section without affecting the others.

### Grouping rule

Grouping uses exact recipe match only. White balance differences, color-tone differences, or other partial similarity should not merge images into the same section.

Each valid image is assigned to a group using an exact recipe fingerprint derived from the parsed settings.

### Existing recipe matching

After grouping, each section runs an existing-recipe lookup using that section's detected recipe settings.

Default section mode:

- exact existing recipe match: default to attaching all images in the group as community samples
- no exact match: default to creating a new recipe using the first image as the recipe's primary uploaded image

The UI should make the mode clear, but exact matches should not require an extra user decision before attaching.

### Review-only support

Users should be able to drop files, see the grouped sections, and learn which recipes are present without uploading anything. No upload begins until a section submit action is clicked.

## Data Flow

### File candidates

Each dropped file becomes a local client-side candidate record with:

- original `File`
- file name
- preview URL or preview-disabled state
- parse status: `pending | parsed | invalid`
- parsed recipe settings when available
- exact grouping fingerprint when available
- file-level error when invalid

### Group construction

Parsed candidates are grouped by exact fingerprint into section records. Each section record owns:

- detected recipe settings
- grouped files
- local metadata fields
- match lookup result
- chosen submission mode
- submit progress and outcomes

Invalid candidates remain outside these groups and are rendered separately.

## Submission Model

Each section has its own submit action. There is no page-wide batch submit.

### Create mode

If a section does not have an exact existing recipe match:

1. use the first image in the section to run the current create flow
2. create the new recipe and upload/finalize that first image
3. attach the remaining images in the section as additional community samples for the newly created recipe

This preserves the existing create semantics while still supporting many images in a section.

### Attach mode

If a section has an exact existing recipe match:

1. target the matched recipe
2. upload and finalize each image in the section as a community sample

### Orchestration strategy

Keep the current prepare/direct-upload/finalize contract and have the client orchestrate it per image within a section. Do not introduce a new bulk server API in the first version.

This is the recommended approach because it:

- matches the requested UX of one submit action per recipe section
- minimizes backend churn
- allows clear per-section failure reporting
- avoids broad changes to security and finalize behavior

## Error Handling

Track errors at two levels.

### File-level errors

File-level errors are discovered before submit:

- EXIF parse failure
- unsupported file
- missing color profile settings
- preview generation failure

Invalid files should remain visible in an `Invalid files` area with the file name and error reason.

### Section-level errors

Section-level errors are discovered during submit:

- existing-recipe lookup failure
- prepare failure
- direct upload failure
- finalize failure

Section submission should process images sequentially. If one image fails:

- stop processing the rest of that section
- preserve the success state of earlier images in that section
- show which image failed and which stage failed
- keep all other sections interactive

This keeps retry behavior simple and avoids ambiguous duplicate uploads.

## Success Handling

Do not auto-redirect after a successful upload. Redirecting made sense for the one-file flow, but it is disruptive when several sections are present on the page.

Instead, each successful section should show a compact summary such as:

- `Recipe created and 3 images uploaded`
- `4 images attached to existing recipe`

The summary should include a link to the created or matched recipe.

## Performance And Rendering Boundaries

The current page appears to rerender heavy upload UI during metadata edits, which makes typing feel slow. The multi-image design must tighten component and form boundaries so editable inputs do not force the expensive parts of the tree to rerender on every keypress.

### Required boundary

Keep forms small in scope:

- the heavy dropzone, preview, parsing, and grouping tree should live outside the text input forms
- each recipe section should isolate its mutable metadata inputs from expensive preview and detection views
- form elements should wrap only the inputs and the submit control for that section, not the entire preview/detection card

### Practical implications

- derive parsed/grouped section data once and treat it as stable review state
- keep section metadata in section-local state
- avoid coupling text input updates to page-wide preview and grouping rerenders
- prefer small section subcomponents over one giant `RecipeUpload` render tree

This performance boundary is part of the feature design, not an optional cleanup.

## Implementation Boundaries

Primary work should stay focused on the upload flow:

- refactor `app/upload/RecipeUpload.jsx` into page-level grouping plus section-level upload units
- reuse `app/upload/DetectedRecipeSettingsCard.jsx` inside each section
- add a small pure helper for exact grouping that can be tested directly
- keep `app/upload/actions.js` mostly intact and extend only where needed to support attaching additional images to a known recipe cleanly

Avoid unrelated recipe-management refactors.

## Testing

Add coverage for:

- grouping multiple parsed files into one exact-match section
- splitting files from different recipes into separate sections
- keeping invalid files out of valid groups
- defaulting exact-match groups to attach mode
- create flow using the first image to create a recipe and the remainder as attachments
- attach flow uploading all images in a matched section
- stopping only the failed section on partial failure
- preserving other sections as usable after one section fails
- removing redirect-on-success when multiple sections are present
- performance-oriented component boundaries where feasible through component-level tests around isolated section forms

## Out Of Scope

- loose grouping by near-match settings
- page-wide submit all behavior
- new bulk upload server APIs
- broader recipe editing UX changes outside the upload page
