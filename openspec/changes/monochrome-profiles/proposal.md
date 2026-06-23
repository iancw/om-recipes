## Why

The site currently assumes every recipe is a color recipe backed by `Color Profile Settings`, a saturation wheel, and a color-only `.oes` export. JPGs shot with OM/Olympus monochrome profiles carry a different EXIF shape, so they cannot be parsed, deduplicated, stored, or rendered as first-class recipes today.

## What Changes

- Add first-class monochrome recipe support alongside existing color recipes
- Introduce recipe typing (`COLOR` vs `MONO`) and move type-specific settings out of the shared `recipes` table into dedicated settings tables
- Extend EXIF parsing and fingerprinting so monochrome uploads can be recognized, deduplicated, and matched without colliding with color recipes
- Update browse, detail, and upload UI to render monochrome-specific settings and let users filter recipes by type
- Add a dedicated monochrome filter rendering spec for how filter color and filter level should be presented in recipe UI surfaces
- Preserve current color recipe behavior while preventing color-only download/export actions from appearing on monochrome recipes until a validated monochrome export path exists

## Capabilities

### New Capabilities
- `monochrome-profile-support`: Uploading, storing, searching, and rendering OM/Olympus monochrome recipes as a first-class recipe type

### Modified Capabilities
- (none)

## Impact

- **DB schema**: add recipe type; create `recipe_color_settings` and `recipe_mono_settings`; migrate existing color-setting columns and fingerprints out of `recipes`
- **Migrations**: one data migration to backfill existing recipes into `recipe_color_settings`
- **EXIF parsing** (`lib/exifparse.js`): detect monochrome picture modes and parse monochrome-only maker-note fields
- **Fingerprinting / upload pipeline** (`lib/recipeFingerprint.js`, `app/upload/actions.js`, `app/upload/RecipeUpload.jsx`): make duplicate detection type-aware and support monochrome variants
- **Recipe reads/UI** (`app/page.jsx`, `app/recipes/search/route.js`, `app/recipes/[id]/page.jsx`, `components/RecipeSettings.jsx`, recipe cards): render the correct settings layout and add Color/Mono filters
- **Monochrome filter rendering** (`components/RecipeSettings.jsx`, related recipe card/detail UI): define and implement how monochrome filter color and filter level are visually represented
- **Recipe editing / downloads** (`app/recipes/[id]/actions.js`, `app/oes/[slug]/route.js`, `components/recipe-card.jsx`): keep fingerprints in sync for both types and suppress unsupported `.oes` downloads for monochrome recipes
