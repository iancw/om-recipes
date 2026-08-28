# Renameable Recipe Slugs — Design Spec

**Date:** 2026-08-28
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Recipe slugs are used in URLs (`/recipes/<slug>`) and are generated once
at upload time from `slugify(authorName)_slugify(recipeName)`
(`app/upload/actions.js:199-215`). They can never change afterward. This
is a problem in practice:

- If a recipe is created without changing the name, it keeps the file name as its title
  (e.g. `P134142142`) and there is now no way to give it a real slug.
- An author may want to change their name for various reasons, but currently the slug will always have their original name

This change makes a recipe's slug recompute automatically when the
recipe is renamed, while keeping every old URL working. Old slugs are
retained as aliases that permanently redirect (HTTP 308) to the current
canonical URL. The recipe `uuid` remains the permanent, never-aliased
fallback identifier.

## Scope decisions

1. **Recipe-rename drives slug changes; author-name changes stay
   manual.** `updateRecipeAction` (`app/recipes/[id]/actions.js:173`)
   recomputes the slug when `recipeName` changes. Author display-name
   changes are *not* wired up: `recipes.authorName` is denormalized and
   separate from `authors.name`, and `updateMyProfileAction`
   (`app/profile/actions.js:38`) only touches `authors.name` today.
   Author-name-driven slug fixes (such as shortening an author's slug
   to initials) are done out of band with a maintenance script
   (see §6).

2. **Old slugs are retained forever and 308-redirect to canonical.**
   There is no privacy opt-out that deletes an alias. For the
   name-in-slug case, this is considered adequately addressed by
   (a) never rendering the old slug anywhere on the site and
   (b) redirecting the old URL to the new one. The old slug still
   *resolves*, which only confirms information a visitor following that
   specific old link already had.

3. **`uuid` stays the permanent floor.** It is never turned into an
   alias and always resolves. Hitting a `uuid`-form URL 308-redirects
   to the canonical slug URL.

4. **No database transactions.** `db/index.ts` uses the `neon-http`
   driver, which does not support `db.transaction()`. The slug-change
   write is an ordered sequence of idempotent statements (see §3).

5. **`?recipe=<slug>` on the catalog page self-heals via a resolver
   route**, not a real HTTP redirect (the homepage is fully
   client-rendered and there is no middleware). See §5.

## 1. Data model

New table `recipe_slug_aliases`:

| column       | type                                            | notes                          |
|--------------|-------------------------------------------------|--------------------------------|
| `id`         | `integer` PK, generated always as identity      |                                |
| `recipe_id`  | `integer` NOT NULL → `recipes(id)` ON DELETE CASCADE | alias dies with the recipe |
| `slug`       | `varchar(255)` NOT NULL                         |                                |
| `created_at` | `timestamptz` NOT NULL default `now()`          |                                |

Indexes:

- `unique(slug)` — a slug resolves to exactly one recipe.
- `index(recipe_id)`.

Global slug uniqueness across `recipes.slug` **and**
`recipe_slug_aliases.slug` is enforced in application code (the
generator checks both tables). There is no cross-table constraint; the
same string may briefly exist in both tables for the *same* recipe
during a rename, and resolution always prefers `recipes.slug`.

### Drizzle schema

Add to `db/schema.ts` following existing table conventions (see
`recipes`). Table name `recipe_slug_aliases`, exported as
`recipeSlugAliases`.

## 2. Slug helper — `lib/recipe-slug.js` (new)

Extract the slug logic currently inline in `app/upload/actions.js`
(`slugify`, `uniqueRecipeSlug`) into a shared module and have
`app/upload/actions.js` import from it. Keep behavior identical for the
upload path.

Exports:

- `slugify(value)` — moved verbatim from `app/upload/actions.js:199`.

- `computeSlugBase({ authorName, recipeName })` →
  `` `${slugify(authorName)}_${slugify(recipeName)}` ``.

- `resolveUniqueSlug({ base, recipeId })` → returns a slug string.
  Checks `recipes.slug` and `recipe_slug_aliases.slug`, **excluding any
  rows belonging to `recipeId` itself**. On collision, append `-2`,
  `-3`, … (same loop as the current `uniqueRecipeSlug`, cap 1000, throw
  on exhaustion). When `recipeId` is not yet known (upload), pass
  `null` and nothing is excluded.

- `applySlugChange({ recipeId, oldSlug, newSlug })` → performs the
  slug change as three ordered idempotent statements (see §3). No-op
  when `newSlug === oldSlug`. Returns `{ changed: boolean, newSlug }`.

## 3. Slug-change write sequence

Executed by `applySlugChange`, in this order (no transaction):

1. `INSERT INTO recipe_slug_aliases (recipe_id, slug)
   VALUES (:recipeId, :oldSlug) ON CONFLICT (slug) DO NOTHING`
2. `UPDATE recipes SET slug = :newSlug, updated_at = now()
   WHERE id = :recipeId`
3. `DELETE FROM recipe_slug_aliases
   WHERE slug = :newSlug AND recipe_id = :recipeId`
   — clears a now-redundant alias row when a rename is reverted to a
   previous slug.

**Crash safety.** A failure between any two steps leaves resolution
correct, because the live `recipes.slug` is always matched before the
alias table and any stray alias row points at the same recipe:

- After step 1 only: `oldSlug` is both the live slug and an alias for
  the same recipe. Harmless; resolves to the right recipe.
- After step 2, before step 3: `newSlug` is the live slug and also
  still an alias row for the same recipe. Harmless duplicate.

**Concurrency.** Two simultaneous renames that compute the same
`newSlug` collide on the `recipes.slug` / `recipe_slug_aliases.slug`
unique indexes; one statement throws and the server action surfaces the
error for the user to retry. Acceptable at this operation's frequency;
no locking or retry loop is added.

This mirrors how `updateRecipeAction` already issues its writes (child
settings table, then `recipes`) without a transaction.

## 4. Write path — `updateRecipeAction`

In `app/recipes/[id]/actions.js` `updateRecipeAction`:

1. Also select `authorName` alongside the existing `id, uuid, slug,
   type` load.
2. The existing `UPDATE recipes` keeps writing `recipeName`,
   `description`, `sourceUrl`, the legacy mirror values, and
   `updatedAt` — but **not** `slug`. After it, compute
   `base = computeSlugBase({ authorName, recipeName })`,
   `newSlug = resolveUniqueSlug({ base, recipeId })`, then
   `applySlugChange({ recipeId, oldSlug: existing.slug, newSlug })`.
   The helper owns the `recipes.slug` write (step 2 of the §3
   sequence); this ordering guarantees the old slug is captured as an
   alias *before* `recipes.slug` moves, so a crash cannot lose the old
   URL.
3. Revalidation: `revalidatePath(getRecipePath({ slug: oldSlug, uuid }))`
   **and** `revalidatePath(getRecipePath({ slug: newSlug, uuid }))` when
   the slug changed, plus the existing
   `revalidatePublicRecipeCatalog()`.

The upload path (`app/upload/actions.js`) is unchanged apart from
importing `slugify` / slug helpers from the new module.

## 5. Read path — resolution and redirects

### `/recipes/<id>` — `app/recipes/[id]/page.jsx`

`getRecipeByIdOrSlug` currently matches `recipes.slug` OR (`uuid` form)
`recipes.uuid`. New behavior:

1. Exact `recipes.slug` match → serve 200 (unchanged).
2. `uuid`-form input that matches `recipes.uuid` → resolve the recipe,
   then `permanentRedirect(getRecipePath(recipe))` (Next.js
   `permanentRedirect`, HTTP 308; crawlers treat as 301).
3. Otherwise look up `recipe_slug_aliases.slug`. On a hit, resolve the
   recipe and `permanentRedirect(getRecipePath(recipe))`.
4. No match anywhere → `notFound()` (unchanged).

The redirect is issued from the page/loader (server component), not
middleware. `getRecipePath` already returns the canonical slug path.

### `/oes/<slug>.oes` — `app/oes/[slug]/route.js`

Add the same alias + `uuid` fallback to the recipe lookup
(`app/oes/[slug]/route.js:34`). This endpoint **serves the file
directly** on an alias/uuid hit — no redirect, since it is a download.

### Catalog `?recipe=<identifier>` — resolver route

The homepage (`app/page.jsx`, `"use client"`) opens a recipe modal from
`?recipe=<identifier>` by matching against loaded catalog results
(`findRecipeIndexByIdentifier`), then rewriting the param to the
canonical identifier via `normalizeRecipeSelectionUrl`
(`app/page.jsx:133`). An old alias slug matches nothing today.

New **resolver route**: `GET /recipes/resolve?recipe=<identifier>`
(`app/recipes/resolve/route.js`, new).

- Looks up `identifier` against `recipes.slug`, `recipes.uuid`, and
  `recipe_slug_aliases.slug`.
- Hit → `Response.json({ canonical: recipe.slug })`.
- Miss → 404 with `Response.json({ error: 'not_found' }, { status: 404 })`.

Client change in `app/page.jsx` `syncSelectedRecipeFromLocation`: when
the identifier is not found among loaded results **and** pagination is
exhausted (`!hasMoreRef.current`), call the resolver. On a hit whose
`canonical` differs from the current param, `replaceState` to
`?recipe=<canonical>` and re-run the sync (which now matches, opening
the modal — loading more pages as needed exactly as today). On a miss,
deselect (current behavior).

This produces the same end state as a redirect — the URL becomes
`?recipe=<latest-slug>` — with one extra request only on the miss path.

## 6. Migration and maintenance script

### Migration

Run `npx drizzle-kit generate` to produce the migration file for
`recipe_slug_aliases`. **Do not apply it** — Ian applies migrations
manually.

### `scripts/fix-recipe-slug.mjs` (new)

For the existing bad slugs (e.g. `P134142142`, or an author slug that
needs shortening to initials) and any future manual author-name fixes.

Usage: `node scripts/fix-recipe-slug.mjs <recipeUuidOrId> [newSlug]`

- With an explicit `newSlug`: `slugify` it, verify uniqueness across
  both tables (excluding self), then run the §3 sequence.
- Without: recompute from the recipe's current `authorName` /
  `recipeName` via `computeSlugBase` + `resolveUniqueSlug`, then run the
  §3 sequence.
- Prints the old slug, new slug, and the alias row created.

Using this script (rather than a raw SQL `UPDATE`) is what guarantees
the old slug is captured as an alias so the old URL 308-redirects
instead of 404ing.

Follows the existing `scripts/*.mjs` conventions (`@netlify/neon` or the
project's script DB helper, `.env` loading as the other scripts do).

## 7. Testing

**Unit (`lib/recipe-slug.js`):**

- `computeSlugBase` — author/name slugification, underscore separator.
- `resolveUniqueSlug` — collides with `recipes.slug`; collides with
  `recipe_slug_aliases.slug`; ignores rows for the same `recipeId`;
  appends `-2`/`-3`; `null` recipeId excludes nothing.
- `applySlugChange` — no-op when unchanged; creates alias + updates
  `recipes.slug` on change; rename-revert deletes the redundant alias
  and restores the prior slug as canonical.

**Write path (`updateRecipeAction`):**

- Rename → `recipes.slug` recomputed, old slug present in
  `recipe_slug_aliases`, both old and new paths revalidated.
- Rename to a value colliding with another recipe → new slug gets a
  numeric suffix.
- Editing description only (name unchanged) → slug untouched, no alias
  row.

**Read path:**

- Old alias URL → 308 to canonical `/recipes/<slug>`.
- `uuid` URL → 308 to canonical.
- Unknown slug → 404.
- `/oes/<oldslug>.oes` → file served (200), no redirect.
- `GET /recipes/resolve?recipe=<alias>` → `{ canonical }`;
  `?recipe=<unknown>` → 404.

## Files touched

| File | Change |
|------|--------|
| `db/schema.ts` | add `recipeSlugAliases` table |
| `migrations/NNNN_*.sql` | generated, not applied |
| `lib/recipe-slug.js` | new — `slugify`, `computeSlugBase`, `resolveUniqueSlug`, `applySlugChange` |
| `app/upload/actions.js` | import slug helpers from `lib/recipe-slug.js` (no behavior change) |
| `app/recipes/[id]/actions.js` | recompute slug + record alias on rename |
| `app/recipes/[id]/page.jsx` | alias + uuid resolution → 308 redirect |
| `app/oes/[slug]/route.js` | alias + uuid fallback (serve file) |
| `app/recipes/resolve/route.js` | new — identifier resolver for `?recipe=` |
| `app/page.jsx` | call resolver on catalog miss, `replaceState` to canonical |
| `scripts/fix-recipe-slug.mjs` | new — maintenance script |
| tests | as in §7 |
