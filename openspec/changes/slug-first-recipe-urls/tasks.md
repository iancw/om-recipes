## 1. Shared URL Identity

- [x] 1.1 Add a shared helper for canonical recipe paths and homepage deep-link query construction that always prefers `recipe.slug`
- [x] 1.2 Add shared parsing logic for legacy homepage query keys and UUID-vs-slug identifier matching
- [x] 1.3 Update any server-side helpers or revalidation paths that currently mint UUID-preferred recipe URLs

## 2. Dedicated Recipe Page

- [x] 2.1 Update `app/recipes/[id]/page.jsx` to resolve either slug or UUID and redirect UUID requests to `/recipes/<slug>`
- [x] 2.2 Ensure metadata and not-found behavior continue to work with slug-first canonical routing

## 3. Homepage Deep Links

- [x] 3.1 Update `app/page.jsx` to store opened recipe state as `?recipe=<slug>`
- [x] 3.2 Preserve backward compatibility for `recipe`, `id`, `uuid`, and `slug` query keys plus UUID values
- [x] 3.3 Normalize resolved legacy deep links with history replacement so modal navigation and back/forward behavior remain stable

## 4. Link Emitters And Crawlable Output

- [x] 4.1 Update recipe href emitters across the app (homepage detail link, upload flow, samples, slot views, related recipes, and similar surfaces) to use `/recipes/<slug>`
- [x] 4.2 Update `app/sitemap.js` to publish slug-based recipe URLs only
- [x] 4.3 Review any user-visible messages or API responses that include recipe URLs so newly generated links use slugs

## 5. Verification

- [x] 5.1 Add or update tests for canonical slug links, UUID backward compatibility, and sitemap output
- [x] 5.2 Manually verify homepage deep links, UUID-to-slug redirects, and representative recipe link surfaces
