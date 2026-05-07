# Cloud Dancer Theme Preview Design

## Summary

The temporary theme preview switcher confirmed that the `Cool Neutral` direction is stronger than the original beige background and preferable to the gray-card variants. This follow-up keeps `Default` and `Cool Neutral`, then replaces the gray-card trio with three near-white `Cloud Dancer` variants inspired by Pantone Cloud Dancer.

## Goals

- Keep the existing temporary header switcher and reuse it for the next comparison round.
- Replace the gray-card variants with three brighter, near-white `Cloud Dancer` options.
- Preserve `Cool Neutral` as the darker reference point alongside the new `Cloud Dancer` set.

## Non-Goals

- No permanent theme feature.
- No persistence, cookies, or URL-driven preview state.
- No new switcher layout or interaction pattern.
- No brand-accent redesign in this pass.

## UX

The temporary switcher should expose these five options:

- `Default`
- `Cool Neutral`
- `Cloud Dancer`
- `Cloud Dancer Steel`
- `Cloud Dancer Mist`

The switcher stays temporary, header-mounted, and reset-on-refresh. Its job is to compare white-family atmospheres, not to become a permanent user setting.

## Palette Behavior

`Cloud Dancer` should be the reference interpretation: bright, airy, near-white, and neutral. It should feel lighter than `Cool Neutral` without reading as stark or clinical.

`Cloud Dancer Steel` should stay in the same brightness range but introduce a cleaner silver-blue cast and slightly sharper separation between page background and surfaces. It should feel cooler and more editorial, not metallic in a heavy-handed way.

`Cloud Dancer Mist` should stay bright and near-white but soften the contrast and introduce a faint atmospheric cast. It should feel lighter and more diffuse than `Cloud Dancer Steel`.

The current green primary remains in place so the comparison stays focused on the neutral foundation rather than shifting multiple axes at once.

## Implementation Notes

- Update `lib/theme-preview.js` to replace the gray-card preview ids and labels with `cloud-dancer`, `cloud-dancer-steel`, and `cloud-dancer-mist`.
- Keep `default` and `cool-neutral` unchanged.
- Update `styles/globals.css` to replace the three gray-card token blocks with three `Cloud Dancer` near-white token blocks.
- Keep semantic surface/foreground token pairs explicit within each preview block so each mode remains self-contained.
- Update the existing preview tests so option ordering and supported ids match the new set.
- Avoid changes to the switcher structure unless needed to reflect the new labels.

## Verification

- Confirm the switcher exposes the new five-option set in the expected order.
- Confirm unsupported preview ids still fall back to the default mode.
- Confirm each `Cloud Dancer` mode feels distinctly brighter than `Cool Neutral`.
- Confirm cards, popovers, muted sections, and borders remain legible and separated across the new near-white variants.
