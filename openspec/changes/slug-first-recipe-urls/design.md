## Context

The app already stores a unique, non-null `recipes.slug`, and the dedicated recipe page can resolve either a slug or a UUID. Despite that, most generated recipe URLs still prefer UUIDs:

- homepage modal selection reads `?id=`, `?uuid=`, or `?slug=` and prefers `recipe.uuid`
- many generated `/recipes/...` links use `recipe.uuid ?? recipe.slug`
- the sitemap currently publishes UUID-first recipe URLs

This creates multiple public URL forms for the same recipe and makes the most shareable surfaces harder to read. The change is cross-cutting because it affects route resolution, client-side history state, generated links, and crawler-facing output.

## Goals / Non-Goals

**Goals:**
- Make the slug the canonical public recipe identifier everywhere the app generates a recipe URL
- Preserve backward compatibility for existing UUID-based recipe URLs and homepage deep links
- Normalize legacy URL forms to the canonical slug form once the recipe is resolved
- Centralize URL-building behavior so new features do not reintroduce UUID-preferred links

**Non-Goals:**
- Changing how slugs are created for new recipes
- Removing the `uuid` column or breaking existing UUID links
- Introducing slug history or alias tables for future slug changes
- Renaming the Next.js route file from `app/recipes/[id]/page.jsx`

## Decisions

### 1. Slug is the canonical public recipe identifier

**Decision:** Any newly generated recipe URL SHALL use `recipes.slug` for the public identifier.

**Rationale:** The slug is already unique, human-readable, and present for every recipe. Reusing it avoids schema work and gives the user-visible readability benefit the change is trying to achieve.

**Alternative considered:** Keep UUID as the canonical public identifier and only display slugs in some places. Rejected because it preserves duplicate URL forms and undermines shareability.

### 2. Homepage deep links use a canonical `recipe` query parameter

**Decision:** The homepage modal state SHALL be represented as `/?recipe=<slug>` going forward.

**Rationale:** A neutral `recipe` key matches the actual payload after the canonical identifier stops being an ID. It also avoids encoding internal storage semantics in the URL.

**Backward compatibility:** The page SHALL continue to accept `recipe`, `id`, `uuid`, and `slug` query keys, and SHALL accept either a slug or UUID value while normalizing successful matches back to `recipe=<slug>`.

**Alternative considered:** Keep `id=<slug>`. Rejected because it keeps a misleading public contract and makes the cleanup incomplete.

### 3. UUID detail-page requests redirect to the slug path

**Decision:** The dedicated recipe page SHALL accept either `/recipes/<slug>` or `/recipes/<uuid>` as input, but UUID requests SHALL redirect to `/recipes/<slug>`.

**Rationale:** Rendering both forms without a redirect leaves multiple canonical-looking URLs for the same recipe. Redirecting collapses sharing, SEO, and cache behavior onto one slug path while preserving old links.

**Alternative considered:** Continue resolving both forms in place with no redirect. Rejected because it keeps duplicate public URLs indefinitely.

### 4. Shared helpers own recipe URL generation and parsing

**Decision:** Introduce a small shared URL helper layer for:
- canonical recipe path generation
- canonical homepage deep-link query generation
- legacy query key parsing

**Rationale:** URL identity is currently duplicated across `app/page.jsx`, recipe-detail links, upload flows, and sitemap generation. A shared helper lowers regression risk and makes the canonical contract obvious.

**Alternative considered:** Update each call site independently. Rejected because the current UUID preference came from exactly that kind of drift.

### 5. All crawlable and user-facing link emitters switch to slug output

**Decision:** Any place that renders or returns a shareable recipe URL SHALL emit the slug form, including sitemap entries and in-app links.

**Rationale:** Canonicalization only works if the app stops minting fresh UUID links after the change ships.

## Risks / Trade-offs

**Legacy deep links may not identify a recipe until search results load** → Keep the current progressive loading behavior on the homepage, but normalize the URL only after the matching recipe has been resolved.

**Client-side normalization can create extra history entries** → Use history replacement when rewriting legacy homepage query params so back/forward behavior remains stable.

**Duplicate content risk if redirect logic is incomplete** → Require all generated links and sitemap entries to emit slugs, and redirect UUID detail-page requests to the slug path.

**Future slug mutability could create stale links** → Keep slug history out of scope for now and continue treating the stored slug as stable after recipe creation.

## Migration Plan

1. Add shared recipe URL helper(s) without changing route structure.
2. Update detail-page resolution to redirect UUID requests to the slug path.
3. Update homepage modal deep-link behavior to use `?recipe=<slug>` and normalize legacy forms.
4. Update all known recipe href emitters and sitemap generation to publish slug URLs only.
5. Verify that existing UUID URLs still resolve via redirect and that legacy homepage query params still open the correct recipe.

Rollback is straightforward: revert the canonicalization helpers and redirect/normalization behavior. No data migration is required.

## Open Questions

- Should the recipe detail page also emit an explicit canonical link tag in metadata, or is redirect-based canonicalization sufficient for now?
- Should the homepage preserve unrelated query parameters when normalizing a legacy recipe deep link? The expected answer is probably yes, but the implementation should confirm that behavior intentionally.
