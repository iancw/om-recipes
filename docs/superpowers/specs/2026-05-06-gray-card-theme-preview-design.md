# Gray-Card Theme Preview Design

## Summary

The current site background reads as warm yellow-beige, which makes the app feel visually similar to many lightly "vibe-coded" interfaces. This change adds a temporary in-app preview switcher so the site can be evaluated against three gray-card-inspired background palettes before choosing a permanent direction.

## Goals

- Compare three background families in one local build: cool neutral, true gray card, and warm gray.
- Keep the comparison centered on shared theme tokens instead of one-off component overrides.
- Make the preview easy to use across pages while keeping it clearly temporary.

## Non-Goals

- No permanent user-facing theme feature.
- No persistence across refreshes or sessions.
- No URL parameters, cookies, or server-side theme state.
- No broad restyling of component structure or page layout.

## UX

A temporary header pill will expose three options:

- `Cool Neutral`
- `Gray Card`
- `Warm Gray`

The control appears in the shared header so it can be used on any page during evaluation. The switcher resets on refresh and does not preserve state. If JavaScript is unavailable, the app remains on the default theme without any broken UI.

The preview should change the overall page atmosphere rather than only swapping a single background color. The body background treatment should lose the current creamy, sunlit feeling and become more restrained and studio-like.

## Palette Behavior

`Gray Card` is the reference option. It should feel closest to a photographic gray card: balanced, neutral, and quiet. Surface layers should still separate cleanly, so cards and popovers need to stay slightly lighter than the page background.

`Cool Neutral` should shift the same structure slightly toward blue-gray, giving the interface a cleaner and crisper feel without becoming stark or metallic.

`Warm Gray` should shift slightly toward taupe while staying meaningfully more neutral than the current beige palette.

The existing green primary color stays in place for the preview so background evaluation remains isolated from brand-accent changes unless contrast problems force a follow-up adjustment.

## Implementation Notes

- Add a small temporary client component in the header for the preview pill.
- Keep the active preview mode in client state only.
- Apply the selected mode through a root data attribute such as `data-theme-preview`.
- Define the three preview palettes by overriding the existing shared tokens in `styles/globals.css`.
- Update the body background gradient alongside the color tokens so each palette reads as a coherent atmosphere.
- Limit the implementation to theme-token and header-control changes unless a contrast issue requires a targeted component tweak.

## Verification

- Confirm first load still shows the default theme with no preview selected.
- Confirm each preview option updates shared theme tokens consistently across the main browsing surfaces.
- Confirm cards, popovers, borders, and muted surfaces remain visually distinct in all three palettes.
- Confirm the temporary pill fits in the header without breaking desktop or mobile navigation layouts.
