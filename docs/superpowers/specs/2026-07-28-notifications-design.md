
# Notifications — Design Spec

**Date:** 2026-07-28
**Status:** Approved design, pending implementation plan
**Author:** Ian Will (with Claude)

## Summary

Add a notification system to om-recipes so users learn about activity relevant
to them. Three event types are supported, delivered over two channels (an
in-app bell/feed in real time, and an optional once-daily email digest), gated
by per-user preferences.

### Triggers

1. **New recipe added** — global opt-in. A user who opts in is notified whenever
   *any* new recipe is added to the system. (No follow/subscribe concept is
   introduced.)
2. **New sample image on your recipe** — the recipe owner is notified when
   someone contributes a sample image to one of their recipes.
3. **Someone saved your recipe** — the recipe owner is notified when a user
   saves one of their recipes. The owner can see who saved it (author name,
   never email).

### Channels

- **In-app bell/feed** — updates in real time; always shows every notification
  the user is subscribed to.
- **Email** — a single **daily digest** (not per-event), sent at **6pm US
  Eastern**, controlled by a master on/off switch.

### Save count

The aggregate save count per recipe is **owner-only / private** — shown only to
the recipe's owner, never on public pages. (This is separate from the save
*notification*.)

## Context & constraints (existing system)

- **Stack:** Next.js 16 (App Router), React 19, Postgres (Neon) via Drizzle ORM,
  hosted on Netlify (Node 22). Tests via Vitest.
- **Identity split:** `users` hold login identity + `email` + `emailVerifiedAt`
  (the notifiable target). `authors` are the public recipe-owner identity.
  A recipe's owner is resolved `recipes.authorId → authors.userId → users`.
  `authors.userId` can be **null** for imported recipes (no notifiable owner).
- **Existing event data:** `saved_recipes` (save toggle) and
  `recipe_sample_images` (contributed samples) tables already exist.
- **Email:** `sendEmail({ to, subject, html, text })` in
  `lib/oci/emailDelivery.js` (OCI Email Delivery). Existing callers: magic-link
  auth and the contact form. No templating layer beyond inline HTML.
- **No DB transactions:** the neon-http driver does not support
  `db.transaction()` (`db/index.ts:7`). **All writes must be idempotent.**
- **Privacy/GDPR:** a retention/export subsystem exists (`lib/privacy*.js`,
  `privacy_requests` table, `scripts/privacy-retention-cleanup.mjs`). New
  user-linked data must plug into export, deletion, and retention.
- **Migrations:** generated via `npm run db:generate` / `db:migrate`
  (drizzle-kit). Never hand-edit migrations.

## Architecture

**Chosen approach: persistent `notifications` table, written inline at each
event source** (Approach A of three considered).

Each event (save, sample-image add, recipe publish) writes notification rows
synchronously in the server action that already handles the event. The in-app
bell reads unread rows; the daily digest job reads un-emailed rows and marks
them sent. One source of truth serves both channels.

Rejected alternatives:
- **B — event outbox + background processor:** over-engineered for three event
  types; adds latency before the bell updates.
- **C — compute-on-read (no table):** no clean read/unread or "digest sent"
  state; the global new-recipe opt-in maps to no per-user rows; read queries
  become expensive; muddier privacy story.

## Data model

Two new tables in `db/schema.ts`, applied via drizzle-generated migrations.

### `notifications`

One row per notification delivered to one recipient.

| Column | Type / target | Purpose |
|---|---|---|
| `id` | serial PK | primary key (matches existing conventions) |
| `uuid` | uuid | external id |
| `recipientUserId` | FK → `users.id` | who receives it |
| `type` | enum: `new_recipe` \| `recipe_saved` \| `sample_image_added` | event type |
| `recipeId` | FK → `recipes.id` | the recipe involved |
| `actorAuthorId` | FK → `authors.id`, nullable | who caused it (rendered as author name) |
| `sampleImageId` | FK → `images.id`, nullable | for `sample_image_added` |
| `dedupeKey` | text, **unique** | idempotency guard (replaces transactions) |
| `readAt` | timestamp, nullable | in-app read state |
| `emailedAt` | timestamp, nullable | digest-sent marker |
| `createdAt` | timestamp | ordering + digest windowing |

**Dedupe keys** (unique index makes re-inserts no-ops):
- save → `save:{recipeId}:{saverUserId}` (re-saving won't re-notify)
- sample image → `sample:{sampleImageId}`
- new recipe → `newrecipe:{recipeId}:{recipientUserId}` (one per subscriber)

`actorAuthorId` is stored for all three types and **rendered as the author's
name** in the UI (names, never emails).

### `notification_preferences`

One row per user; all booleans. A **missing row means defaults apply in code**
(no backfill of existing users required).

| Column | Type | Default | Meaning |
|---|---|---|---|
| `userId` | FK → `users.id`, unique | — | owner of prefs |
| `notifyNewRecipe` | boolean | **false** | opt-in global new-recipe feed |
| `notifySampleImage` | boolean | **true** | sample images on my recipes |
| `notifySave` | boolean | **true** | saves on my recipes |
| `emailDigestEnabled` | boolean | **true** | email master switch |

### Save count

No new storage. Computed as `COUNT(*)` over `saved_recipes` for the owner's
recipes, shown only to the owner.

## Event generation (write path)

A new `lib/notifications.js` module exposes small writer helpers; event sources
call one function each.

1. **New recipe** — in the recipe-publish path (`app/recipes/actions.js`), after
   successful create, call `notifyNewRecipe(recipeId)`. **Fan-out:** query all
   users with `notifyNewRecipe = true`, insert one row each
   (`newrecipe:{recipeId}:{userId}`). Skip the recipe's own author.
2. **Sample image added** — in `app/my-samples/actions.js`, after the image is
   attached, call `notifySampleImageAdded(recipeId, sampleImageId,
   contributorAuthorId)`. Resolve owner; skip if owner is null or is the
   contributor; check owner's `notifySampleImage`; insert one row.
3. **Recipe saved** — in the save toggle (`app/recipes/save/route.js` /
   `lib/recipe-saves.js`), **only on the save direction** (not unsave), call
   `notifyRecipeSaved(recipeId, saverUserId)`. Resolve owner; skip self; check
   owner's `notifySave`; insert (`save:{recipeId}:{saverUserId}`).

**Properties (given no transactions):**
- **Idempotent inserts** — every insert is `INSERT … ON CONFLICT (dedupeKey) DO
  NOTHING`. Retries, re-runs, and unsave→resave never duplicate or double-email.
- **Preference check at write time** — no row is created if the recipient has
  that type off. Consequence: turning a type **on** only affects future events
  (no retroactive backfill). The email master switch is checked later, at digest
  time, so disabling email still leaves in-app bell entries.
- **Failure isolation** — notification writes are wrapped so a failure never
  breaks the underlying action (save/sample/publish still succeeds; the
  notification is logged-and-dropped). Notifications are best-effort.
- Imported recipes with `authors.userId = null` produce no owner notification.

## In-app bell / feed (read path)

**UI:** a bell icon in the site header with an unread-count badge. Clicking
opens a panel listing recent notifications, newest first, each linking to the
relevant recipe:
- _"Jane added a sample image to **Golden Hour**"_
- _"Jane saved **Muted Mono**"_ (owner-only; saver's author name shown)
- _"New recipe: **Coastal Fog** by Alex"_

**Data access** (`lib/notifications.js`):
- `getNotificationsForUser(userId, { limit })`
- `getUnreadCount(userId)`

**Routes:**
- `GET /api/notifications` — auth-gated (`requireUser()`), returns recent items
  for the panel.
- `POST /api/notifications/read` — marks listed items (or all) read (`readAt =
  now`).

**Read/unread:** opening the panel marks the listed items read. Badge =
`COUNT(readAt IS NULL)`.

**Edge states:** logged-out users see no bell; empty state for no notifications;
panel caps at latest ~50 (a full `/notifications` page is a possible later
addition).

## Email digest

**Scheduled function:** `netlify/functions/notification-digest.js`.

**DST handling:** Netlify cron runs in UTC and Eastern shifts with daylight
saving. The function is scheduled to run **hourly** but only builds-and-sends
when the current time is **6pm in `America/New_York`** (computed timezone-aware
in the function). This gives exactly 6pm Eastern year-round; off-hour runs are a
cheap no-op.

**Logic:**
1. Find users with `emailDigestEnabled = true`, verified email
   (`emailVerifiedAt` not null), and ≥1 notification with `emailedAt IS NULL`.
2. Gather each user's un-emailed notifications, group by type, build one summary
   email — _"Today on OM Recipes: 3 saves, 1 new sample image on your recipes, 2
   new recipes."_ — with links.
3. Send via `sendEmail()`.
4. On success, set `emailedAt = now` on those rows.

**Idempotency (mark-after-send, accepted tradeoff):** select un-emailed rows,
send, then mark immediately. Residual risk: a crash *after* send but *before*
marking could re-include those items the next day. Accepted given daily cadence
and best-effort semantics. Send failures are logged and rows left unmarked to
retry next day.

**Unsubscribe / manage preferences (required in every email):** the footer of
every digest includes:
- **One-click unsubscribe** — `/notifications/unsubscribe?token=…` with a signed
  per-user token (reusing the existing hashed-token pattern from magic-link
  auth). Sets `emailDigestEnabled = false` **without requiring login**, shows a
  confirmation page. Also emitted as a `List-Unsubscribe` header so mail clients
  show their native unsubscribe button.
- **Manage preferences** — a login-gated link to the preferences page.

**Config:** sender + schedule from existing env/config; sane daily default.

## Preferences UI

A "Notifications" settings section in the existing user/account area, following
current page patterns. Four controls mapping to `notification_preferences`:
- ☐ Notify me about new recipes _(default off)_
- ☑ New sample images on my recipes _(default on)_
- ☑ Saves on my recipes _(default on)_
- ☑ Email me a daily digest _(default on)_

Saved via a server action that **upserts** the prefs row (idempotent). The
unsubscribe token link also lands here after flipping the email switch off.

## Save-count display

On the owner's own recipe views (my-recipes / recipe management), show _"Saved N
times"_ per recipe via `COUNT(*)` on `saved_recipes`. Owner-only; never on public
recipe pages.

## Privacy / GDPR

New user-linked data plugs into the existing retention/export subsystem:
- **Export:** include a user's received `notifications` and their
  `notification_preferences` in their data export.
- **Deletion:** on user deletion, remove their notification rows and prefs.
- **Retention:** add old-notification pruning (e.g. rows older than N days) to
  `scripts/privacy-retention-cleanup.mjs`.

Match existing privacy-code patterns rather than inventing new ones.

## Testing (Vitest)

Unit tests for:
- Dedupe/idempotency — double-insert is a no-op.
- Self-action skipping (owner saving/adding-sample-to their own recipe).
- Preference gating at write time (type off ⇒ no row).
- New-recipe fan-out (one row per opted-in user, author excluded).
- Digest grouping + mark-after-send (rows marked only after successful send).
- Unsubscribe-token flip (valid token disables email without login; invalid
  token rejected).

Email delivery / `sendEmail` is mocked.

## Out of scope (v1)

- Push notifications.
- Per-author follow/subscribe.
- Public save counts / likes / comments / ratings.
- Per-channel-per-type matrix or user-choosable email cadence (only a single
  digest master switch in v1).
- A standalone `/notifications` full-history page (panel-only in v1).
