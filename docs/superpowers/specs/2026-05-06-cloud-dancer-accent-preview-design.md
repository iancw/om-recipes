# Cloud Dancer Accent Preview Design

## Summary

The current `Cloud Dancer` preview round proved the near-white background direction, but the primary button color still uses the shared green brand token. This follow-up keeps the temporary header switcher and uses it to compare three accent-led `Cloud Dancer` variants so button color can be evaluated in real page context.

## Goals

- Keep the existing temporary header preview switcher and reuse it for accent comparison.
- Preserve `Default` and `Cool Neutral` as reference points.
- Replace the current `Cloud Dancer` trio with three accent-led variants built on the same near-white foundation.
- Let the default button, outline button, ghost button, and link styles reflect each accent choice coherently.

## Non-Goals

- No permanent theme feature.
- No persistence, cookies, or URL-driven preview state.
- No switcher redesign beyond updating labels and supported modes.
- No attempt to define an "official Pantone complement" for Cloud Dancer.

## UX

The temporary switcher should expose these five options:

- `Default`
- `Cool Neutral`
- `Cloud Dancer Coral`
- `Cloud Dancer Terracotta`
- `Cloud Dancer Ink`

The switcher remains a temporary design tool mounted in the header and reset on refresh.

## Palette Behavior

All three `Cloud Dancer` variants should share the same near-white neutral foundation so the comparison isolates accent direction instead of changing multiple visual axes at once.

`Cloud Dancer Coral` should be the boldest option: warm, clear, and immediately legible as an accent against the `Cloud Dancer` background.

`Cloud Dancer Terracotta` should be darker, earthier, and slightly less saturated than coral while still reading as a distinct accent color.

`Cloud Dancer Ink` should provide a cool deep-blue option that feels premium and high-contrast without falling back toward the current green identity.

## Implementation Notes

- Update `lib/theme-preview.js` so the supported preview ids and labels become `cloud-dancer-coral`, `cloud-dancer-terracotta`, and `cloud-dancer-ink`.
- Keep `default` and `cool-neutral` unchanged.
- Update `styles/globals.css` so each new preview mode overrides the shared `Cloud Dancer` surface tokens and the semantic accent tokens that drive interactive elements.
- At minimum, each accent-led preview block should set `--color-primary`, `--color-primary-foreground`, and `--color-ring`.
- Preserve consistent hover, focus, outline, and link behavior by relying on the semantic button and link tokens already consumed by shared components.
- Avoid structural changes to the switcher unless needed to reflect the new labels.

## Verification

- Confirm the switcher exposes the new five-option set in the expected order.
- Confirm unsupported preview ids still normalize to `default`.
- Confirm the default button, outline button, ghost button, and link styles all read coherently in each new accent mode.
- Confirm the new accent colors maintain acceptable contrast against the `Cloud Dancer` background and foreground system.
