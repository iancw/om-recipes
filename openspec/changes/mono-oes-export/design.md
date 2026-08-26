## Context

`monochrome-profiles` decision #6 deferred `.oes` export for monochrome recipes pending a validated mapping. The user supplied 18 sample `.oes` files exported directly from OM Workspace's Monochrome Creator panel, in `Comparison Images/MonoOES`, named `mono-<filter>-<strength>-<tone>-<grain>.oes`, each isolating one combination of filter color, filter strength, film tone, and grain level (the rest left at neutral/off). All 18 share this shape:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ImageProcessing>
	<ParametersType FormatID="65539" Platform="M" Version="2401" />
	<Parameters>
		<RawEditMode Apply="true" Mode="2" />
		<FinishingMode Apply="true" Mode="Natural" />
		<ColorCreater Mode="Off" />
		<MonochroCreater Mode="Manual" SatValue="{strength}" HueValue="{filter}" Graininess="{grain}" ColorTone="{tone}" />
	</Parameters>
</ImageProcessing>
```

## Decisions

### 1. Mapping tables, derived from the 18 sample files

**HueValue** (filter color, `monochromeColor`): `none`=0, `yellow`=1, `orange`=2, `red`=3, `magenta`=4, `blue`=5, `cyan`=6, `green`=7, `yellow-green`=8. This matches the order already used by `components/MonochromeColorFilterDisplay.jsx`'s `FILTER_COLORS` wheel, which is independent corroborating evidence for the ordering.

**SatValue** (filter strength, `monochromeColorStrength`): passed through directly, clamped 0-3 (matches the camera's reported `Strength X; 0; 3` range and the UI's existing `clampLevel` clamp). Forced to `0` whenever the filter is `none`, regardless of any stored strength — verified by all 6 `mono-none-*` samples.

**ColorTone** (film tone, `filmHue`): `normal`/`neutral`=1, `sepia`=2, `blue`=3, `purple`=4, `green`=5. These five exactly match the camera's `Monochrome Color` EXIF tag values seen in `openspec/changes/monochrome-profiles/sample-exif/`.

**Graininess** (`filmGrain`): `off`=0, `low`=1, `medium`=2, `high`=3, matching the camera's `Film Grain Effect` tag values.

All four mappings validate byte-for-byte against all 18 sample files (see `tests/oes-mono-mapping.test.js`).

**Alternative considered:** Infer the mapping purely from EXIF field ordering (e.g. "Strength; min; max" position) without the sample `.oes` files. Rejected — EXIF tells us the *camera's* representation, not OM Workspace's OES attribute encoding, and guessing the encoding without ground truth is exactly what decision #6 wanted to avoid.

### 2. Reuse the shared tone-curve/white-balance/contrast/sharpness elements from the color exporter

**Decision:** The monochrome OES document keeps `ExposureBias`, `WhiteBalance`, `Contrast`, `Sharpness`, and `ToneControl` generated the same way as color recipes, and additionally emits `FinishingMode` (`Mode="Natural"`) before them, then `ColorCreater Mode="Off"` + `MonochroCreater` at the end (in place of `ColorCreater2`).

**Rationale:** The 18 samples are deliberately minimal — they omit those five elements because they were hand-built in OM Workspace to isolate only the Monochrome Creator controls. But real monochrome recipes do carry contrast/sharpness/tone/white-balance/EV settings (`recipe_mono_settings` has all the same shared columns as `recipe_color_settings`), and the color exporter's use of those five elements is already validated in production. The safest inference is that `FinishingMode` is required to select the base picture-mode context that `MonochroCreater` applies within (present in every single sample, at a consistent position right after `RawEditMode`), while the shared elements compose independently.

**Risk:** This combination — shared elements + `FinishingMode` + `MonochroCreater` all together — is not itself in the sample set and has not been round-tripped through OM Workspace. Flagged as an open follow-up in the proposal.

**Alternative considered:** Only emit the four elements seen in the samples (`RawEditMode`, `FinishingMode`, `ColorCreater`, `MonochroCreater`), dropping tone/WB/contrast/sharpness entirely for monochrome exports. Rejected — that would silently discard real recipe data (a monochrome recipe with, say, `contrast: -2` would export as if contrast were untouched), which is a worse failure mode than the composition risk above.

### 3. `supportsOesDownload` becomes unconditionally `true`

**Decision:** `lib/recipe-data.js` no longer gates `supportsOesDownload` on recipe type.

**Rationale:** Once `makeOESXml` handles both types, there's no remaining case where a persisted recipe can't produce *some* OES output — even a monochrome recipe with no filter/tone/grain set exports the neutral defaults (matching `mono-none-off-n-off.oes`).

## Risks / Trade-offs

- **Unverified full-recipe round-trip** — see decision #2. Mitigation: proposal calls out manual verification against OM Workspace as a follow-up.
- **Filter/tone label parsing is string-based** — EXIF label text (e.g. `"Yellow-Green Filter"`) is normalized case/whitespace/hyphen-insensitively before lookup, with unrecognized values falling back to the neutral default (no filter / normal tone / no grain) rather than throwing, so a novel camera firmware string degrades gracefully instead of breaking downloads.
