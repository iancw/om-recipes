## Why

Recipe records already have stable slugs, but the app still prefers UUIDs in public recipe URLs, homepage deep links, and the sitemap. That makes shared links opaque even though the data needed for readable, identifiable URLs already exists.

## What Changes

- Make the recipe slug the canonical public identifier for generated recipe URLs.
- Use slug-based deep links on the homepage recipe modal so shared index-page URLs are readable.
- Keep UUID-based recipe URLs and legacy homepage query parameters working for backward compatibility.
- Normalize resolved legacy UUID links to the canonical slug URL so users land on a single shareable form.
- Update crawlable/generated surfaces such as the sitemap and recipe links throughout the UI to emit slug URLs.

## Capabilities

### New Capabilities

- `recipe-url-addressing`: Canonical slug-based recipe URLs across the homepage deep-link query parameter and dedicated recipe detail pages, with UUID alias support

### Modified Capabilities

- `sitemap`: Recipe entries use slug-based canonical URLs instead of UUID-preferred paths

## Impact

- `app/page.jsx` deep-link parsing, modal state, and browser history updates
- `app/recipes/[id]/page.jsx` recipe lookup and canonical redirect behavior
- Shared recipe link generation in upload flows, sample views, slot editors, and related recipe links
- `app/sitemap.js` URL generation for recipe entries
- Potential shared helper(s) for canonical recipe href/query generation and legacy identifier resolution
- No schema changes; `recipes.slug` already exists and is unique
