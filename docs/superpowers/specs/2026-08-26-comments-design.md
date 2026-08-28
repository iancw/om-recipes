
# Comments — Design Spec

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Add flat (non-threaded) comments on recipes so authors get direct feedback on
their work, closing the loop with the notification system already built —
"someone commented on your recipe" becomes another event on the bell and in
the daily digest. Goal: increase repeat engagement from recipe authors and
encourage more recipe uploads.

Comments were explicitly called out as out-of-scope in the notifications
design (`2026-07-28-notifications-design.md`); this spec picks that back up.

### Scope decisions

1. **Flat only** — one list of comments per recipe, no threaded replies.
   Matches the scale of the community and keeps the schema/UI simple.
2. **Moderation: self + owner delete** — a comment's author can delete their
   own comment; the recipe's owner can delete any comment on their own
   recipe (same model as YouTube). No report/flag flow in v1 — the site has
   one admin (the owner) who can act directly on the database for rare abuse.
3. **Comment count is public** — shown on the recipe detail page (and
   optionally cards) as a discovery signal ("this recipe has active
   discussion"). This is a deliberate departure from the save-count
   precedent (owner-only): saving is a private bookmarking action, but a
   comment is already public content the moment it's posted, so hiding the
   count adds no privacy value.
4. **No effect on ranking** — comment count is informational only; sort
   order continues to be driven by saves.

## Context & constraints (existing system)

- **Stack:** Next.js 16 (App Router), React 19, Postgres (Neon) via Drizzle
  ORM, hosted on Netlify (Node 22). Tests via Vitest.
- **Identity split:** `users` hold login identity (email, magic-link auth).
  `authors` are the public-facing recipe-owner/contributor identity and may
  have `userId = null` (imported recipes with no login). Commenting requires
  a logged-in user; on first comment, resolve/create their author record via
  the existing `findOrCreateAuthorForUser` (same call the upload flow
  already uses), so a user who has never uploaded a recipe can still
  comment under their own name.
- **Existing FK convention for contributor references:** tables like
  `recipe_sample_images` reference `authors.id` with `onDelete: 'set null'`
  — the row survives if the author record is later detached from its user,
  it just loses the identity link. `comments.authorId` follows the same
  pattern.
- **No DB transactions:** the neon-http driver does not support
  `db.transaction()` (`db/index.ts:7`). Writes must tolerate no atomicity;
  comments are simple single-row inserts so this is a non-issue, except for
  the cooldown check below (best-effort, not strictly race-proof).
- **Notifications infra already exists** (`lib/notifications.js`,
  `notifications` / `notification_preferences` tables, bell UI, 6pm Eastern
  digest email). Comments plug into this as a fourth event type rather than
  building anything new for delivery.
- **Privacy/GDPR:** a retention/export subsystem exists (`lib/privacy*.js`,
  `privacy_requests` table, `scripts/privacy-retention-cleanup.mjs`). New
  user-linked data must plug into export and deletion, following the same
  pattern notifications used.
- **Migrations:** generated via `npm run db:generate` / `db:migrate`
  (drizzle-kit). Never hand-edit migrations.

## Data model

One new table in `db/schema.ts`.

### `comments`

| Column | Type / target | Purpose |
|---|---|---|
| `id` | serial PK | primary key (matches existing conventions) |
| `uuid` | uuid | external id |
| `recipeId` | FK → `recipes.id`, `onDelete: cascade` | which recipe |
| `authorId` | FK → `authors.id`, `onDelete: set null` | who wrote it |
| `body` | text, app-enforced max 2000 chars, trimmed non-blank | comment text |
| `createdAt` | timestamp | display order, cooldown check |

Indexes: `recipeId` (list query, count), `authorId` (privacy export/deletion,
cooldown check).

No `deletedAt` — deletion is a hard delete. Keeps the privacy story simple
(a deletion request or moderation delete just removes the row) and there's
no product need for a "deleted" tombstone at this scale.

## Server actions / write path

New `lib/comments.js` (data layer, mirrors `lib/notifications.js` style):
- `getCommentsForRecipe(recipeId)` — ordered oldest-first, joined to author
  name.
- `getCommentCountForRecipe(recipeId)` — `COUNT(*)`, public.
- `addComment({ recipeId, authorId, body })` — validates length/non-blank,
  enforces the cooldown, inserts.
- `deleteComment({ commentId, requestingAuthorId, recipeOwnerAuthorId })` —
  allowed if the requester is the comment's author OR the recipe's owner.

Server actions in the recipe detail page's `app/recipes/[id]/actions.js`
(alongside the existing update/delete recipe actions):
- `addCommentAction(recipeId, body)` — `requireUser()`, resolves/creates the
  author via `findOrCreateAuthorForUser`, calls `addComment`, calls
  `notifyRecipeCommented` (see below), revalidates the recipe path.
- `deleteCommentAction(recipeId, commentId)` — `requireUser()`, resolves the
  requester's author id, calls `deleteComment`, revalidates the recipe path.

**Spam guardrail (soft, no new infra):** `addComment` rejects a new comment
if the same `authorId` has a comment (on any recipe) with `createdAt` within
the last 15 seconds. This is a basic accidental-double-post / drive-by-spam
speed bump, not a real abuse system — read-then-write, so not strictly
race-proof without transactions, which is an accepted tradeoff at this
traffic scale. Real abuse prevention for account creation itself is tracked
separately in `openspec/changes/harden-magic-link-abuse-controls`.

## UI / read path

**Recipe detail page** (`app/recipes/[id]/page.jsx`), new "Comments" section
below the sample gallery:
- Header shows the count: _"Comments (4)"_.
- Logged-in users see a textarea + submit button above the list.
- Logged-out visitors see the list with a "Sign in to comment" prompt in
  place of the textarea (reuses the existing magic-link flow).
- List is oldest-first, each row: author name, relative timestamp, body,
  and a delete control shown only to the comment's author or the recipe
  owner.
- Empty state: "No comments yet — be the first to say something."

**Recipe card:** the count badge from the detail page is small enough to
also add to `RecipeCard`/`RecipeSimpleCard` as a lightweight signal (e.g. a
speech-bubble icon + number) — same visual treatment level as existing
badges, not a v1 blocker if it turns out to clutter the card.

## Notifications integration

Extends the existing system rather than building new delivery:
- New `notification_type` enum value: `comment`.
- New `notification_preferences` column: `notifyComment`, boolean, default
  **true** (same default tier as `notifySave`/`notifySampleImage`).
- New `lib/notifications.js` writer: `notifyRecipeCommented(recipeId,
  commentId, commenterAuthorId)` — resolves the recipe owner, skips if the
  owner is null or is the commenter (self-skip, same pattern as
  `notifyRecipeSaved`), checks `notifyComment` preference, inserts with
  dedupe key `comment:{commentId}`.
- Bell/panel line: _"Jane commented on **Golden Hour**"_.
- Digest email: comments join the existing grouped summary — _"Today on OM
  Recipes: 2 comments, 3 saves, ..."_.
- Preferences UI gains one more checkbox: "☑ Comments on my recipes
  _(default on)_", next to the existing three.

## Privacy / GDPR

Follows the same pattern notifications used:
- **Export:** include a user's own posted comments (via their author
  record) in their data export.
- **Deletion:** on user/account deletion (`eraseAccountData` in
  `lib/privacy.js`), the user's own recipes and author record are
  **hard-deleted**, not detached. Comments the user wrote **on their own
  recipes** are cascade-deleted along with those recipes
  (`comments.recipeId → recipes`, `onDelete: cascade`). Comments the user
  wrote **on other people's recipes** are not explicitly targeted for
  deletion; they survive but lose their identity link when the author row
  is deleted, becoming anonymized (`comments.authorId` → `set null`) — the
  same fate that already befalls, e.g., `recipe_sample_images.authorId`
  for contributions a deleted user made to someone else's recipe. The
  comments UI falls back to a generic label (e.g. "Someone", matching the
  existing `actorAuthorName ?? 'Someone'` fallback already used in
  `NotificationBell.jsx`) when an author is null. No new deletion
  semantics needed; `eraseAccountData` requires no code change for
  comments.
- **Retention:** no separate retention job needed — comments aren't
  ephemeral data like notifications; they live as long as the recipe does
  (cascade-deleted with it).

## Testing (Vitest)

- Adding a comment: validation (blank/over-length rejected), happy path.
- Cooldown: second comment within 15s rejected; after 15s allowed.
- Delete permissions: author can delete own; recipe owner can delete any on
  their recipe; a third party cannot delete either.
- Self-comment doesn't notify the owner.
- Notification preference gating (`notifyComment = false` ⇒ no row).
- Comment count query correctness.

## Out of scope (v1)

- Threaded replies / mentions.
- Editing an existing comment (delete-and-repost is the workaround).
- Report/flag flow.
- Rich text/markdown formatting — plain text only.
- Comment count feeding into recipe ranking/sort order.
