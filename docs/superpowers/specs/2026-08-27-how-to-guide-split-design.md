# How-to → Multi-Page Guides Section — Design Spec

**Date:** 2026-08-27
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

The site's instructional content lives on a single `/how-to` page that
scrolls through two anchored sections (OM Workspace `.OES` files, and
loading a recipe into the camera from a JPG). It is hard to link to a
single topic, hard to grow, and missing two topics people ask about:
entering a recipe **by hand on the camera**, and a plain-language
explanation of **what the recipe settings actually are**.

This splits `/how-to` into a lightweight hub plus four standalone guide
pages, adds a shared sub-navigation strip for cross-linking, renames the
header nav item to **Guides**, and updates the sitemap. Two of the four
pages are existing content moved verbatim; two are newly written.

Tracked informally as open ideas in `IDEAS.md` ("How does the site
work?", "How do you input recipes with the creative dial?", "Support
non-color-wheel profiles").

## Scope decisions

1. **Hub page is kept, not redirected.** `/how-to` stays a real URL and
   becomes a hero + four cards. No redirect logic, existing inbound links
   keep working, and it remains the single header nav target.

2. **Children nested under `/how-to/*`.** Routes are
   `/how-to/om-workspace`, `/how-to/camera-from-jpg`,
   `/how-to/om-3-profiles`, `/how-to/how-profiles-work` — grouped under
   the hub rather than bare top-level slugs, so the URL space stays
   organized and the hub URL stays meaningful.

3. **One header nav entry.** [lib/navigation.js](../../../lib/navigation.js)
   `How-to` item is renamed to `Guides`, `href` stays `/how-to`. No
   dropdown. Discovery of the four guides happens on the hub and via the
   shared sub-nav strip.

4. **Cross-linking via a shared sub-nav strip**, rendered on all five
   pages (hub + four guides): a row of pill links to each guide with the
   current page marked. This is the only new navigational UI.

5. **Two new pages are v1-lightweight.** `how-profiles-work` is roughly
   one screen of prose (the "Overview" depth, not a full settings
   reference). `om-3-profiles` is written from the OM-3 manual and forum
   sources with image slots left as placeholders for Ian to fill later.
   Neither page reuses the site's recipe-rendering React components in
   v1 — that is a possible later enhancement, explicitly out of scope
   here.

6. **No backend, data, or schema changes.** This is entirely static
   pages, one nav constant, one sitemap constant, and shared presentational
   components.

7. **Existing screenshots are reused as-is.** Files under
   `/public/images/how-to/` stay where they are; the two moved sections
   keep their current `StepImage` references.

## Context & constraints (existing system)

- **Stack:** Next.js 16 (App Router), React server components, Tailwind,
  the local `components/ui/*` primitives (`Card`, `Badge`, etc.). Hosted
  on Netlify.
- **Current page:** [app/how-to/page.jsx](../../../app/how-to/page.jsx) —
  a single server component that defines three local helpers (`Step`,
  `StepImage`, `Callout`) inline, exports `metadata`, and renders a hero,
  a two-card TOC, and two `<section>` blocks with `id` anchors.
- **Navigation:** [lib/navigation.js](../../../lib/navigation.js) exports
  `publicNavItems` and `authedNavItems`; both list
  `{ href: '/how-to', linkText: 'How-to' }`. Consumed by
  [components/HeaderNav.jsx](../../../components/HeaderNav.jsx) and
  `MobileMenu`.
- **Sitemap:** [app/sitemap.js](../../../app/sitemap.js) has
  `const STATIC_PAGES = ['/', '/about', '/how-to']`. Covered by
  [tests/sitemap.test.js](../../../tests/sitemap.test.js), which asserts
  the exact static-entry list.
- **Testing:** Vitest. Page-level components are tested by mocking `db`,
  `lib/auth`, and child components, then asserting on rendered output or
  passed props (see [tests/my-samples-page.test.js](../../../tests/my-samples-page.test.js),
  [tests/recipe-detail-page.test.js](../../../tests/recipe-detail-page.test.js)).
  There is currently **no** test for `/how-to`.
- **Metadata:** root layout sets a title template `%s | OM Recipes`; each
  page exports its own `metadata` with `title` and `description`.

## Architecture

### Routes

| Route | File | Title (`metadata.title`) | Content |
|---|---|---|---|
| `/how-to` | `app/how-to/page.jsx` (rewritten) | `Guides` | Hero + 4 cards + sub-nav |
| `/how-to/om-workspace` | `app/how-to/om-workspace/page.jsx` (new) | `Using OM Workspace Batch Files (.OES)` | Existing §1, moved |
| `/how-to/camera-from-jpg` | `app/how-to/camera-from-jpg/page.jsx` (new) | `Load a Recipe Into Your Camera From a JPG` | Existing §2, moved |
| `/how-to/om-3-profiles` | `app/how-to/om-3-profiles/page.jsx` (new) | `Enter a Recipe by Hand on the OM-3` | New, researched |
| `/how-to/how-profiles-work` | `app/how-to/how-profiles-work/page.jsx` (new) | `How Color Profiles & Recipes Work` | New, overview |

### Shared components

New directory `app/how-to/_components/` (App Router convention: the
leading underscore keeps it out of routing). All are presentational
server components — no `'use client'`.

- **`guide-primitives.jsx`** — `Step`, `StepImage`, `Callout`, moved
  verbatim from the current page. Single source of truth for all guide
  pages.
- **`GuideSubNav.jsx`** — renders the pill-link strip. Takes a
  `current` prop (one of a small set of slug constants). The link list
  is a module-level constant `GUIDE_PAGES = [{ slug, href, label }, …]`
  co-located here. The hub passes `current="hub"` (or omits it) so no
  pill is marked active.
- **`GuideLayout.jsx`** — wraps a guide page: outer
  `<div className="mx-auto w-full max-w-4xl px-8 py-10 space-y-10">`,
  the `Badge` + `<h1>` + lede hero (props: `title`, `intro`), and
  `<GuideSubNav current={…} />`. Children are the page body. This keeps
  each `page.jsx` down to metadata + a content tree.

`GUIDE_PAGES` is also the natural source for the hub's four cards and
can be imported by [app/sitemap.js](../../../app/sitemap.js) so the
route list has one definition. (Sitemap currently hardcodes strings;
importing a shared constant is a small, in-scope improvement.)

### Navigation change

[lib/navigation.js](../../../lib/navigation.js): in both `publicNavItems`
and `authedNavItems`, change `linkText: 'How-to'` → `linkText: 'Guides'`.
`href` unchanged. No other file touched — `HeaderNav` and `MobileMenu`
map over the arrays generically.

### Sitemap change

[app/sitemap.js](../../../app/sitemap.js): replace the literal
`'/how-to'` in `STATIC_PAGES` with the hub plus the four child paths
(preferably derived from the shared `GUIDE_PAGES` constant:
`['/', '/about', '/how-to', ...GUIDE_PAGES.map(p => p.href)]`).
[tests/sitemap.test.js](../../../tests/sitemap.test.js) expectations
updated to match the new list (two `it` blocks assert the exact array).

## Content plan — new pages

### `how-profiles-work` (overview, ~1 screen)

Plain-language, no images required in v1. Sections:

1. **What a recipe is** — a named bundle of picture settings the camera
   applies as you shoot; on this site every recipe is one Color Profile
   or Monochrome Profile plus its supporting settings.
2. **The color wheel** — per-band hue rotation and saturation across the
   ~12 hue bands the site renders; what "rotating a band" does to those
   colors in the final JPEG.
3. **Tone & contrast** — the highlight/shadow tone-curve control and
   overall contrast.
4. **White balance** — WB preset / Kelvin plus the A–B / G–M shift, and
   the note (echoed from the JPG guide) that WB does not travel with a
   JPG-loaded profile.
5. **Monochrome vs color** — mono profiles add color-filter effect,
   toning, and film-grain; they occupy separate camera slots.
6. **Where the camera keeps them** — Color 1–4 / Mono 1–4 profile
   slots vs Custom Modes C1–C5 vs Picture Mode; how "load into a slot"
   and "assign to a Custom Mode" differ.
7. **Cross-links** to the three how-to guides.

### `om-3-profiles` (researched, image slots as placeholders)

Written from the OM-3 instruction manual and corroborating forum
threads. Known facts to build on (verify exact menu wording against the
manual during implementation):

- The **Creative Dial** has COLOR, MONO, ART, and **CRT** (Color
  Creator) positions. COLOR/MONO expose Color 1–4 / Mono 1–4 profiles
  for editing.
- Per profile the camera can set: color-wheel band values, tone curve
  (highlight/shadow), sharpness, contrast, white balance, gradation,
  and — for mono — filter effect and toning; plus vignette/shading.
- **Custom Modes C1–C5** capture the full Creative-Dial state, so a
  recipe is preserved by storing it to a C mode after editing the
  profile.

Page structure: intro (when you'd do this vs the JPG workflow) →
"Read the recipe values off this site" → step list for entering wheel
values → step list for curve / contrast / sharpness / WB → "Save to a
Color slot and a Custom Mode" → callout on what can't be entered by
hand. `StepImage` calls reference `/images/how-to/om-3-*.png` paths
that don't exist yet; Ian adds the photos later. Anything not confirmed
from a source is marked inline as "verify on your camera."

## Error handling

Static pages — no runtime error paths. Missing placeholder images on
`om-3-profiles` render as broken `next/image` until the files are added;
acceptable for an intermediate state, and the implementation plan will
note it as a known follow-up rather than shipping broken `<img>` to
production. Options if that's unacceptable at ship time: comment out the
`StepImage` calls until assets exist, or gate them behind a simple
"images coming soon" note.

## Testing

Match the existing page-test pattern (mock `components/ui/*` and shared
primitives, render the server component, assert output):

- **`tests/how-to-hub-page.test.js`** — hub renders `<h1>` and one card
  per entry in `GUIDE_PAGES`.
- **One test per new guide page** (or a single parametrized test over
  the four routes) — page renders its expected `<h1>` and the
  `GuideSubNav` marks the correct pill active.
- **`tests/sitemap.test.js`** — update the two expected-array assertions
  to include the four new paths.
- Optional: a `GuideSubNav` unit test that `current` toggles the active
  class.

Manual verification via the dev server: screenshot each of the five
pages in light and dark mode; confirm the header shows **Guides** and it
links to `/how-to`; confirm sub-nav links resolve.

## Out of scope

- Reusing the recipe-rendering components (saturation wheel, curve
  display) inside `how-profiles-work`.
- Real photography/screenshots for `om-3-profiles` (Ian provides later).
- Any redirect or URL-migration handling (`/how-to` is unchanged).
- Guides for other camera bodies (OM-1, older Olympus). The
  `om-3-profiles` page is deliberately body-specific; a generalization
  is a future issue.
- Footer navigation changes.

## Implementation notes

- Create a `bd` issue for the work before starting.
- Quality gates before push: `npm test` (or project's vitest command),
  lint, `next build`.
- Migrations: none.
