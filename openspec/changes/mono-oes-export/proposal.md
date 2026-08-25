## Why

`monochrome-profiles` (decision #6) intentionally suppressed `.oes` downloads for `MONO` recipes because the app had no validated mapping from monochrome settings (`monochromeColor`, `monochromeColorStrength`, `filmGrain`, `filmHue`) to an OM Workspace batch processing file. `lib/oes.js` only knew how to emit the color `ColorCreater2` saturation-wheel element, and `app/oes/[slug]/route.js` returned `409` for any monochrome recipe.

We now have 18 ground-truth `.oes` files exported directly from OM Workspace's Monochrome Creator panel (one attribute isolated per file, covering all 9 filter colors, all 4 filter strengths, all 5 film tones, and all 4 grain levels), which is enough to reverse-engineer the `MonochroCreater` element and ship monochrome exports.

## What Changes

- Extend `lib/oes.js` to emit a `MonochroCreater`-based OES document for `MONO` recipes (filter color/strength, film tone, grain), reusing the existing shared tone-curve / white-balance / contrast / sharpness elements
- Remove the `409` block in `app/oes/[slug]/route.js` so monochrome recipes serve a real `.oes` file
- Enable the `.oes` download link on monochrome recipe cards and drop the "not available yet" messaging
- Mark monochrome recipes as `supportsOesDownload: true` in the normalized recipe view model

## Capabilities

### Modified Capabilities
- `monochrome-profile-support`: supersedes decision #6 ("Suppress `.oes` downloads for monochrome recipes") — monochrome recipes now support `.oes` export

## Impact

- **OES generation** (`lib/oes.js`): add a monochrome branch and filter/tone/grain mapping tables
- **Download route** (`app/oes/[slug]/route.js`): remove the monochrome `409` response
- **Recipe view model** (`lib/recipe-data.js`): `supportsOesDownload` is now `true` for all recipe types
- **Recipe card UI** (`components/recipe-card.jsx`): show the OES download link for monochrome recipes
- **Help copy** (`app/how-to/page.jsx`): mention Monochrome Creator settings alongside Color Profile settings

## Open Questions / Follow-ups

- The 18 sample files are minimal batch files (only `RawEditMode`, `FinishingMode`, `ColorCreater`, `MonochroCreater` — no `ExposureBias`/`WhiteBalance`/`Contrast`/`Sharpness`/`ToneControl`). This change merges the monochrome-specific elements with the existing shared elements used by color exports; that combination has not been round-trip verified against a full real-world monochrome recipe in OM Workspace. Recommend validating a generated `.oes` for a recipe with non-default tone/WB/contrast values against OM Workspace before considering this fully verified.
- `monochromeVignetting` is parsed and stored but still has no known OES representation (consistent with the current color exporter, which also does not emit `shadingEffect`), so it is intentionally left out of the generated XML.
