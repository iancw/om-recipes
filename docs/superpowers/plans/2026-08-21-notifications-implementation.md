# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notification system (in-app bell + daily email digest) for three events — new recipe published, sample image added to your recipe, and someone saved your recipe — gated by per-user preferences, plus an owner-only save-count display.

**Architecture:** A persistent `notifications` table is written inline, synchronously, at each event's existing write site (recipe create, sample-image finalize, save toggle). The in-app bell reads unread rows via a small API; a Netlify scheduled function reads un-emailed rows once a day at 6pm Eastern, sends one digest email per user, and marks the rows emailed. A `notification_preferences` table (one row per user, missing row = defaults) gates both channels. All writes are `INSERT … ON CONFLICT (dedupe_key) DO NOTHING` because the `neon-http` driver has no `db.transaction()`.

**Tech Stack:** Next.js 16 (App Router) / React 19, Drizzle ORM against Postgres (Neon via `@netlify/neon`), Vitest, Netlify scheduled Functions (`@netlify/functions` v5), OCI Email Delivery (`lib/oci/emailDelivery.js`).

**Spec:** `docs/superpowers/specs/2026-07-28-notifications-design.md` — read it alongside this plan; this plan implements it and calls out three places where the real codebase differs from the spec's file paths (noted per-task below).

## Global Constraints

- No DB transactions (neon-http driver) — every multi-step write must be idempotent (`ON CONFLICT … DO NOTHING` / `DO UPDATE`), per `db/index.ts:7`.
- Never hand-edit migration SQL — only `npm run db:generate` (drizzle-kit diffs the schema against `migrations/meta`; it does **not** need a live DB connection). Do **not** run `npm run db:migrate` as part of this implementation — that applies migrations to the linked Neon DB via `netlify dev:exec` and is a deploy-time step for the user to run deliberately.
- Preference defaults when a user has no `notification_preferences` row: `notifyNewRecipe=false`, `notifySampleImage=true`, `notifySave=true`, `emailDigestEnabled=true`. No backfill of existing users.
- Every notification insert is `onConflictDoNothing()` on the unique `dedupeKey`. Every write site wraps its notification call so a failure never breaks the underlying action (save/finalize/create must still succeed).
- `actorAuthorId` renders as the author's **name**, never an email.
- Save counts are owner-only; never rendered on public recipe pages.
- 4-space indentation, single quotes, `'use server'`/`'use client'` directives where the codebase already uses them — match the style of the file being edited.
- Tests live in `tests/*.test.js` (flat directory, Vitest, `environment: 'node'`). Mock `../db/index.ts` and `../lib/auth.js` with `vi.mock` the same way `tests/delete-my-sample-image.test.js` and `tests/recipe-save-route.test.js` do — copy their chain-mock style exactly.

**Deviations from the spec's stated file paths (found during codebase exploration):**
1. Spec says the new-recipe write path is `app/recipes/actions.js` — that file is an empty stub. The real recipe-creation write happens in `prepareRecipeUploadAction` in `app/upload/actions.js`. Task 6 hooks there instead.
2. Spec says the sample-image write path is `app/my-samples/actions.js` — that file only has a *delete* action. The real "attach sample image to a recipe" write happens in `ensureRecipeSampleImageLink()` inside `finalizeRecipeUploadAction` in `app/upload/actions.js`. Task 5 hooks there instead.
3. Spec describes the unsubscribe token as "reusing the existing hashed-token pattern from magic-link auth" (a random token whose hash is stored, single-use). Magic-link tokens are one-time-use; an unsubscribe link must stay valid across every digest email for the life of the account, which a single stored hash can't do (once a second token/hash is issued, prior emails' links break). Task 12 instead uses a **deterministic HMAC-signed token** (`HMAC-SHA256(secret, userUuid)`), recomputed on demand and verified with `timingSafeEqual` — no storage, no expiry, stable forever, matches the spec's "signed per-user token" wording without the single-use mismatch.

---

### Task 1: Schema — `notifications` and `notification_preferences` tables

**Files:**
- Modify: `db/schema.ts`
- Create (generated): a new file under `migrations/` via `npm run db:generate`

**Interfaces:**
- Produces: `notificationTypeEnum`, `notifications`, `notificationPreferences` tables and their relations, importable from `../db/schema.ts` (or `../../db/schema.ts` etc. depending on caller depth) as named exports. Columns used by later tasks: `notifications.{id, uuid, recipientUserId, type, recipeId, actorAuthorId, sampleImageId, dedupeKey, readAt, emailedAt, createdAt}`; `notificationPreferences.{id, userId, notifyNewRecipe, notifySampleImage, notifySave, emailDigestEnabled, createdAt, updatedAt}`.

- [ ] **Step 1: Add the enum and both tables to `db/schema.ts`**

Add near the top, after `recipeTypeEnum`:

```ts
export const notificationTypeEnum = pgEnum('notification_type', ['new_recipe', 'recipe_saved', 'sample_image_added']);
```

Add after the `modeSlotAssignments` table definition (before the `relations(...)` blocks):

```ts
export const notifications = pgTable(
    'notifications',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        uuid: uuid('uuid').defaultRandom().notNull(),
        recipientUserId: integer('recipient_user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        type: notificationTypeEnum('type').notNull(),
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        actorAuthorId: integer('actor_author_id').references(() => authors.id, { onDelete: 'set null' }),
        sampleImageId: integer('sample_image_id').references(() => images.id, { onDelete: 'set null' }),
        dedupeKey: text('dedupe_key').notNull(),
        readAt: timestamp('read_at', { withTimezone: true }),
        emailedAt: timestamp('emailed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('notifications_uuid_unique').on(t.uuid),
        uniqueIndex('notifications_dedupe_key_unique').on(t.dedupeKey),
        index('notifications_recipient_user_id_read_at_idx').on(t.recipientUserId, t.readAt),
        index('notifications_recipient_user_id_created_at_idx').on(t.recipientUserId, t.createdAt),
        index('notifications_emailed_at_idx').on(t.emailedAt).where(sql`${t.emailedAt} is null`)
    ]
);

export const notificationPreferences = pgTable(
    'notification_preferences',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        notifyNewRecipe: boolean('notify_new_recipe').notNull().default(false),
        notifySampleImage: boolean('notify_sample_image').notNull().default(true),
        notifySave: boolean('notify_save').notNull().default(true),
        emailDigestEnabled: boolean('email_digest_enabled').notNull().default(true),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [uniqueIndex('notification_preferences_user_id_unique').on(t.userId)]
);
```

Add relations after the existing relations blocks:

```ts
export const notificationsRelations = relations(notifications, ({ one }) => ({
    recipient: one(users, {
        fields: [notifications.recipientUserId],
        references: [users.id]
    }),
    recipe: one(recipes, {
        fields: [notifications.recipeId],
        references: [recipes.id]
    }),
    actorAuthor: one(authors, {
        fields: [notifications.actorAuthorId],
        references: [authors.id]
    }),
    sampleImage: one(images, {
        fields: [notifications.sampleImageId],
        references: [images.id]
    })
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
    user: one(users, {
        fields: [notificationPreferences.userId],
        references: [users.id]
    })
}));
```

Also extend `usersRelations` to add `notifications: many(notifications)` and `notificationPreferences: one(notificationPreferences, { fields: [users.id], references: [notificationPreferences.userId] })` alongside the existing `authors: many(authors)` etc. entries.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `NNNN_<name>.sql` file appears under `migrations/` (next number after `0020_curly_starbolt.sql`) containing `CREATE TYPE "notification_type"`, `CREATE TABLE "notifications"`, `CREATE TABLE "notification_preferences"`, and the indexes above. Read the generated file to confirm it matches — do not hand-edit it. Do **not** run `npm run db:migrate`.

- [ ] **Step 3: Commit**

```bash
git add db/schema.ts migrations/
git commit -m "feat(notifications): add notifications and notification_preferences tables"
```

---

### Task 2: `lib/notifications.js` — preference read/write helpers

**Files:**
- Create: `lib/notifications.js`
- Test: `tests/notification-preferences.test.js`

**Interfaces:**
- Consumes: `db` from `../db/index.ts`; `notificationPreferences` from `../db/schema.ts`; `eq` from `drizzle-orm`.
- Produces: `NOTIFICATION_PREFERENCE_DEFAULTS` (object), `getEffectivePreferences(userId): Promise<{notifyNewRecipe, notifySampleImage, notifySave, emailDigestEnabled}>`, `upsertNotificationPreferences(userId, {notifyNewRecipe, notifySampleImage, notifySave, emailDigestEnabled}): Promise<void>`. Later tasks import both.

- [ ] **Step 1: Write the failing tests**

```js
// tests/notification-preferences.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let getEffectivePreferences;
let upsertNotificationPreferences;
let NOTIFICATION_PREFERENCE_DEFAULTS;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

describe('notification preferences', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        getEffectivePreferences = mod.getEffectivePreferences;
        upsertNotificationPreferences = mod.upsertNotificationPreferences;
        NOTIFICATION_PREFERENCE_DEFAULTS = mod.NOTIFICATION_PREFERENCE_DEFAULTS;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns defaults when no preferences row exists', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([]))
        }));

        const prefs = await getEffectivePreferences(42);
        expect(prefs).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
    });

    it('returns the stored row when one exists', async () => {
        const stored = {
            notifyNewRecipe: true,
            notifySampleImage: false,
            notifySave: true,
            emailDigestEnabled: false
        };
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([stored]))
        }));

        const prefs = await getEffectivePreferences(42);
        expect(prefs).toEqual(stored);
    });

    it('upserts preferences with onConflictDoUpdate on userId', async () => {
        const onConflictDoUpdate = vi.fn(() => Promise.resolve());
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        insertMock = vi.fn(() => ({ values }));

        await upsertNotificationPreferences(42, {
            notifyNewRecipe: true,
            notifySampleImage: false,
            notifySave: false,
            emailDigestEnabled: true
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 42,
                notifyNewRecipe: true,
                notifySampleImage: false,
                notifySave: false,
                emailDigestEnabled: true
            })
        );
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notification-preferences.test.js`
Expected: FAIL — `lib/notifications.js` does not exist yet.

- [ ] **Step 3: Write `lib/notifications.js` (preferences section only)**

```js
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { notificationPreferences } from '../db/schema.ts';

export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
    notifyNewRecipe: false,
    notifySampleImage: true,
    notifySave: true,
    emailDigestEnabled: true
});

export async function getEffectivePreferences(userId) {
    const rows = await db
        .select({
            notifyNewRecipe: notificationPreferences.notifyNewRecipe,
            notifySampleImage: notificationPreferences.notifySampleImage,
            notifySave: notificationPreferences.notifySave,
            emailDigestEnabled: notificationPreferences.emailDigestEnabled
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);

    return rows[0] ?? { ...NOTIFICATION_PREFERENCE_DEFAULTS };
}

export async function upsertNotificationPreferences(userId, values) {
    const normalized = {
        notifyNewRecipe: Boolean(values?.notifyNewRecipe),
        notifySampleImage: Boolean(values?.notifySampleImage),
        notifySave: Boolean(values?.notifySave),
        emailDigestEnabled: Boolean(values?.emailDigestEnabled)
    };

    await db
        .insert(notificationPreferences)
        .values({ userId, ...normalized })
        .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { ...normalized, updatedAt: new Date() }
        });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notification-preferences.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.js tests/notification-preferences.test.js
git commit -m "feat(notifications): add preference read/upsert helpers"
```

---

### Task 3: `lib/notifications.js` — writer helpers (dedupe, self-skip, pref-gating, failure isolation)

**Files:**
- Modify: `lib/notifications.js`
- Test: `tests/notification-writers.test.js`

**Interfaces:**
- Consumes: `getEffectivePreferences` from Task 2 (same file).
- Produces: `saveDedupeKey(recipeId, saverUserId)`, `sampleImageDedupeKey(sampleImageId)`, `newRecipeDedupeKey(recipeId, recipientUserId)` (pure string builders); `notifyRecipeSaved(recipeId, saverUserId): Promise<void>`, `notifySampleImageAdded(recipeId, sampleImageId, contributorAuthorId): Promise<void>`, `notifyNewRecipe(recipeId): Promise<void>`. None of these throw — failures are caught and logged internally. Tasks 4–6 call these three functions.

- [ ] **Step 1: Write the failing tests**

```js
// tests/notification-writers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let notifyRecipeSaved;
let notifySampleImageAdded;
let notifyNewRecipe;
let saveDedupeKey;
let sampleImageDedupeKey;
let newRecipeDedupeKey;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

function selectSequence(responses) {
    const queue = [...responses];
    return vi.fn(() => {
        const res = queue.shift() ?? [];
        return {
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(res)),
            then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
    });
}

function insertRecorder() {
    const onConflictDoNothing = vi.fn(() => Promise.resolve());
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    return { insert, values, onConflictDoNothing };
}

describe('notification writers', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        notifyRecipeSaved = mod.notifyRecipeSaved;
        notifySampleImageAdded = mod.notifySampleImageAdded;
        notifyNewRecipe = mod.notifyNewRecipe;
        saveDedupeKey = mod.saveDedupeKey;
        sampleImageDedupeKey = mod.sampleImageDedupeKey;
        newRecipeDedupeKey = mod.newRecipeDedupeKey;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds the spec dedupe key formats', () => {
        expect(saveDedupeKey(5, 9)).toBe('save:5:9');
        expect(sampleImageDedupeKey(7)).toBe('sample:7');
        expect(newRecipeDedupeKey(5, 9)).toBe('newrecipe:5:9');
    });

    describe('notifyRecipeSaved', () => {
        it('skips when the saver is the recipe owner', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9 }]]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyRecipeSaved(5, 9);

            expect(rec.insert).not.toHaveBeenCalled();
        });

        it('skips when the owner has notifySave off', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9 }],
                [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: false, emailDigestEnabled: true }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyRecipeSaved(5, 20);

            expect(rec.insert).not.toHaveBeenCalled();
        });

        it('inserts an idempotent row with the saver author name resolved', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9 }],
                [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, emailDigestEnabled: true }],
                [{ id: 33 }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyRecipeSaved(5, 20);

            expect(rec.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    recipientUserId: 9,
                    type: 'recipe_saved',
                    recipeId: 5,
                    actorAuthorId: 33,
                    dedupeKey: 'save:5:20'
                })
            );
            expect(rec.onConflictDoNothing).toHaveBeenCalledTimes(1);
        });

        it('does nothing when the recipe has no notifiable owner', async () => {
            selectMock = selectSequence([[]]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyRecipeSaved(5, 20);

            expect(rec.insert).not.toHaveBeenCalled();
        });
    });

    describe('notifySampleImageAdded', () => {
        it('skips when the contributor is the owner (self-upload)', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9 }]]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifySampleImageAdded(5, 100, 1);

            expect(rec.insert).not.toHaveBeenCalled();
        });

        it('inserts when a different author contributes a sample', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9 }],
                [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, emailDigestEnabled: true }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifySampleImageAdded(5, 100, 2);

            expect(rec.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    recipientUserId: 9,
                    type: 'sample_image_added',
                    recipeId: 5,
                    actorAuthorId: 2,
                    sampleImageId: 100,
                    dedupeKey: 'sample:100'
                })
            );
        });
    });

    describe('notifyNewRecipe', () => {
        it('fans out to opted-in users, excluding the recipe author', async () => {
            selectMock = selectSequence([
                [{ authorId: 1, ownerUserId: 9 }],
                [{ userId: 9 }, { userId: 20 }, { userId: 21 }]
            ]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyNewRecipe(5);

            expect(rec.values).toHaveBeenCalledWith([
                expect.objectContaining({ recipientUserId: 20, dedupeKey: 'newrecipe:5:20' }),
                expect.objectContaining({ recipientUserId: 21, dedupeKey: 'newrecipe:5:21' })
            ]);
        });

        it('does nothing when nobody is opted in', async () => {
            selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9 }], []]);
            const rec = insertRecorder();
            insertMock = rec.insert;

            await notifyNewRecipe(5);

            expect(rec.insert).not.toHaveBeenCalled();
        });
    });

    it('swallows and logs a failure instead of throwing', async () => {
        selectMock = vi.fn(() => {
            throw new Error('db down');
        });

        await expect(notifyRecipeSaved(5, 20)).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notification-writers.test.js`
Expected: FAIL — the writer functions don't exist yet.

- [ ] **Step 3: Append the writer helpers to `lib/notifications.js`**

Add these imports to the top of `lib/notifications.js` (merge with the existing `drizzle-orm` import from Task 2):

```js
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authors, notificationPreferences, notifications, recipes } from '../db/schema.ts';
```

Append below the preferences helpers:

```js
export function saveDedupeKey(recipeId, saverUserId) {
    return `save:${recipeId}:${saverUserId}`;
}

export function sampleImageDedupeKey(sampleImageId) {
    return `sample:${sampleImageId}`;
}

export function newRecipeDedupeKey(recipeId, recipientUserId) {
    return `newrecipe:${recipeId}:${recipientUserId}`;
}

async function withFailureIsolation(label, fn) {
    try {
        await fn();
    } catch (error) {
        console.error(`[notifications] ${label} failed`, error);
    }
}

async function getRecipeOwner(recipeId) {
    const rows = await db
        .select({
            authorId: authors.id,
            ownerUserId: authors.userId
        })
        .from(recipes)
        .innerJoin(authors, eq(authors.id, recipes.authorId))
        .where(eq(recipes.id, recipeId))
        .limit(1);

    return rows[0] ?? null;
}

export async function notifyRecipeSaved(recipeId, saverUserId) {
    await withFailureIsolation('notifyRecipeSaved', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId) return;
        if (owner.ownerUserId === saverUserId) return;

        const prefs = await getEffectivePreferences(owner.ownerUserId);
        if (!prefs.notifySave) return;

        const saverAuthorRows = await db
            .select({ id: authors.id })
            .from(authors)
            .where(eq(authors.userId, saverUserId))
            .orderBy(asc(authors.id))
            .limit(1);
        const actorAuthorId = saverAuthorRows[0]?.id ?? null;

        await db
            .insert(notifications)
            .values({
                recipientUserId: owner.ownerUserId,
                type: 'recipe_saved',
                recipeId,
                actorAuthorId,
                dedupeKey: saveDedupeKey(recipeId, saverUserId)
            })
            .onConflictDoNothing();
    });
}

export async function notifySampleImageAdded(recipeId, sampleImageId, contributorAuthorId) {
    await withFailureIsolation('notifySampleImageAdded', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner?.ownerUserId) return;
        if (owner.authorId === contributorAuthorId) return;

        const prefs = await getEffectivePreferences(owner.ownerUserId);
        if (!prefs.notifySampleImage) return;

        await db
            .insert(notifications)
            .values({
                recipientUserId: owner.ownerUserId,
                type: 'sample_image_added',
                recipeId,
                actorAuthorId: contributorAuthorId,
                sampleImageId,
                dedupeKey: sampleImageDedupeKey(sampleImageId)
            })
            .onConflictDoNothing();
    });
}

export async function notifyNewRecipe(recipeId) {
    await withFailureIsolation('notifyNewRecipe', async () => {
        const owner = await getRecipeOwner(recipeId);
        if (!owner) return;

        const subscriberRows = await db
            .select({ userId: notificationPreferences.userId })
            .from(notificationPreferences)
            .where(eq(notificationPreferences.notifyNewRecipe, true));

        const recipientUserIds = subscriberRows
            .map((row) => row.userId)
            .filter((userId) => userId !== owner.ownerUserId);

        if (recipientUserIds.length === 0) return;

        await db
            .insert(notifications)
            .values(
                recipientUserIds.map((recipientUserId) => ({
                    recipientUserId,
                    type: 'new_recipe',
                    recipeId,
                    actorAuthorId: owner.authorId,
                    dedupeKey: newRecipeDedupeKey(recipeId, recipientUserId)
                }))
            )
            .onConflictDoNothing();
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notification-writers.test.js`
Expected: PASS (all cases, including the failure-isolation case)

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.js tests/notification-writers.test.js
git commit -m "feat(notifications): add dedupe-safe writer helpers with self-skip and pref gating"
```

---

### Task 4: Wire `notifyRecipeSaved` into the save toggle

**Files:**
- Modify: `lib/recipe-saves.js`
- Test: `tests/recipe-saves.test.js`

**Interfaces:**
- Consumes: `notifyRecipeSaved(recipeId, saverUserId)` from `./notifications.js` (Task 3).

- [ ] **Step 1: Write the failing test**

```js
// tests/recipe-saves.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let deleteMock;
let notifyRecipeSavedMock;
let toggleSavedRecipeForUser;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: (...args) => notifyRecipeSavedMock(...args)
}));

describe('toggleSavedRecipeForUser', () => {
    beforeEach(async () => {
        vi.resetModules();
        notifyRecipeSavedMock = vi.fn(() => Promise.resolve());
        const mod = await import('../lib/recipe-saves.js');
        toggleSavedRecipeForUser = mod.toggleSavedRecipeForUser;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('notifies the owner when saving (insert branch)', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([]))
        }));
        insertMock = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));

        const result = await toggleSavedRecipeForUser({ userId: 20, recipeId: 5 });

        expect(result).toEqual({ isSaved: true });
        expect(notifyRecipeSavedMock).toHaveBeenCalledWith(5, 20);
    });

    it('does not notify when unsaving (delete branch)', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([{ recipeId: 5 }]))
        }));
        deleteMock = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));

        const result = await toggleSavedRecipeForUser({ userId: 20, recipeId: 5 });

        expect(result).toEqual({ isSaved: false });
        expect(notifyRecipeSavedMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recipe-saves.test.js`
Expected: FAIL — `toggleSavedRecipeForUser` doesn't call `notifyRecipeSaved` yet.

- [ ] **Step 3: Wire the call in `lib/recipe-saves.js`**

Add the import at the top:

```js
import { notifyRecipeSaved } from './notifications.js';
```

In `toggleSavedRecipeForUser`, change the insert branch (only the save direction, not unsave) from:

```js
    await db.insert(savedRecipes).values({
        userId: normalizedUserId,
        recipeId: normalizedRecipeId
    });

    return { isSaved: true };
```

to:

```js
    await db.insert(savedRecipes).values({
        userId: normalizedUserId,
        recipeId: normalizedRecipeId
    });

    await notifyRecipeSaved(normalizedRecipeId, normalizedUserId);

    return { isSaved: true };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recipe-saves.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full existing save-route test to confirm no regression**

Run: `npx vitest run tests/recipe-save-route.test.js`
Expected: PASS (this test mocks `../lib/recipe-saves.js` entirely so it's unaffected, but confirm)

- [ ] **Step 6: Commit**

```bash
git add lib/recipe-saves.js tests/recipe-saves.test.js
git commit -m "feat(notifications): notify recipe owner on save (not unsave)"
```

---

### Task 5: Wire `notifySampleImageAdded` into sample-image finalize

**Files:**
- Modify: `app/upload/actions.js`
- Test: `tests/finalize-notify-sample-image.test.js`

**Interfaces:**
- Consumes: `notifySampleImageAdded(recipeId, sampleImageId, contributorAuthorId)` from `../../lib/notifications.js`.

- [ ] **Step 1: Read the existing finalize test to match its mocking style**

Read `tests/finalize-resize.test.js` first — it already mocks `../db/index.ts` and object storage for `finalizeRecipeUploadAction`; match its exact chain-mock shapes so the new test doesn't duplicate incompatible mocks.

- [ ] **Step 2: Write the failing test**

```js
// tests/finalize-notify-sample-image.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let updateMock;
let notifySampleImageAddedMock;
let finalizeRecipeUploadAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'owner@example.com' } })
}));

vi.mock('../lib/notifications.js', () => ({
    notifySampleImageAdded: (...args) => notifySampleImageAddedMock(...args)
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: vi.fn(() => ({})),
    getObjectStorageNamespaceFromEnv: vi.fn(() => 'ns'),
    headObject: vi.fn(() => Promise.resolve({ contentLength: 100 })),
    getObject: vi.fn(),
    createPreauthenticatedRequest: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve())
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

describe('finalizeRecipeUploadAction notifies on sample image add', () => {
    beforeEach(async () => {
        vi.resetModules();
        notifySampleImageAddedMock = vi.fn(() => Promise.resolve());

        // First select: the image + author join lookup inside finalizeRecipeUploadAction.
        selectMock = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() =>
                Promise.resolve([
                    {
                        id: 100,
                        authorId: 2,
                        authorUserId: 9,
                        smallUrl: 'https://cdn/small.jpg',
                        fullSizeUrl: 'https://cdn/full.jpg',
                        sha256Hash: 'abc',
                        originalFileSize: 100,
                        preparedRecipeId: 5,
                        preparedObjectKey: 'authors/a/recipes/r/img.jpg',
                        finalizedAt: new Date()
                    }
                ])
            )
        }));

        insertMock = vi.fn(() => ({
            values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) }))
        }));
        updateMock = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }));

        const mod = await import('../app/upload/actions.js');
        finalizeRecipeUploadAction = mod.finalizeRecipeUploadAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls notifySampleImageAdded with the recipe, image, and contributor author', async () => {
        await finalizeRecipeUploadAction({ parameters: { imageId: 100, originalFileSize: 100 } });

        expect(notifySampleImageAddedMock).toHaveBeenCalledWith(5, 100, 2);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/finalize-notify-sample-image.test.js`
Expected: FAIL — `notifySampleImageAdded` is not called yet. (If the mock chain shapes don't match the real query calls, adjust them to match what `finalizeRecipeUploadAction` actually calls — inspect `app/upload/actions.js:873-889` for the exact `.select().from().innerJoin().where().limit()` chain before finalizing the mock.)

- [ ] **Step 4: Wire the call in `app/upload/actions.js`**

Add the import near the other `lib/` imports at the top of the file:

```js
import { notifySampleImageAdded } from '../../lib/notifications.js';
```

`ensureRecipeSampleImageLink` is called from two places inside `finalizeRecipeUploadAction` (the already-finalized short-circuit around line 925-926, and the main path around line 1017). In both places, immediately after `await ensureRecipeSampleImageLink();`, add:

```js
            await notifySampleImageAdded(preparedRecipeId, requestedImageId, img[0].authorId);
```

(matching the existing indentation at each call site — one is inside the `if (img[0].finalizedAt) { ... }` block, the other is at the top level of the function body). The writer itself is idempotent (`sample:{sampleImageId}` dedupe key) and self-skipping, so calling it every time `ensureRecipeSampleImageLink` runs — including on retries/re-finalizes — is safe.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/finalize-notify-sample-image.test.js`
Expected: PASS

- [ ] **Step 6: Run the existing finalize/upload tests to confirm no regression**

Run: `npx vitest run tests/finalize-resize.test.js tests/prepare-recipe-upload.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/upload/actions.js tests/finalize-notify-sample-image.test.js
git commit -m "feat(notifications): notify recipe owner when a sample image is added"
```

---

### Task 6: Wire `notifyNewRecipe` into recipe creation

**Files:**
- Modify: `app/upload/actions.js`
- Test: `tests/prepare-upload-notify-new-recipe.test.js`

**Interfaces:**
- Consumes: `notifyNewRecipe(recipeId)` from `../../lib/notifications.js`.

- [ ] **Step 1: Read the existing prepare-upload test to match its mocking style**

Read `tests/prepare-recipe-upload.test.js` first and copy its mock shapes for `db`, `findOrCreateAuthorForUser`, `createRecipeWithSettings`, and object storage.

- [ ] **Step 2: Write the failing test**

```js
// tests/prepare-upload-notify-new-recipe.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let notifyNewRecipeMock;
let prepareRecipeUploadAction;

const baseParams = {
    author: 'Jane Doe',
    name: 'Golden Hour',
    notes: '',
    sourceUrl: '',
    imageMeta: { type: 'image/jpeg', name: 'a.jpg', size: 100 },
    recipeSettings: {
        hasColorProfileSettings: true,
        hasToneLevel: true,
        source: 'test'
    }
};

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'author@example.com' } }),
    findOrCreateAuthorForUser: () => Promise.resolve({ id: 1, uuid: 'author-uuid', name: 'Jane Doe' })
}));

vi.mock('../lib/notifications.js', () => ({
    notifyNewRecipe: (...args) => notifyNewRecipeMock(...args)
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve())
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: vi.fn(() => ({})),
    getObjectStorageNamespaceFromEnv: vi.fn(() => 'ns'),
    createPreauthenticatedRequest: vi.fn(() => Promise.resolve('https://par.example/upload'))
}));

describe('prepareRecipeUploadAction notifies subscribers on new recipe creation', () => {
    beforeEach(async () => {
        vi.resetModules();
        notifyNewRecipeMock = vi.fn(() => Promise.resolve());
        const mod = await import('../app/upload/actions.js');
        prepareRecipeUploadAction = mod.prepareRecipeUploadAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls notifyNewRecipe with the newly created recipe id when a recipe is created', async () => {
        // Rely on the module's real dedupe/select path finding no existing recipe and
        // creating one; if the real query/insert chain requires a fuller db mock than
        // this, extend this test with the same `db/index.ts` mock shape used in
        // tests/prepare-recipe-upload.test.js rather than re-deriving it.
        const result = await prepareRecipeUploadAction({ parameters: baseParams });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
    });

    it('does not call notifyNewRecipe when attaching to an existing recipe', async () => {
        const result = await prepareRecipeUploadAction({
            parameters: {
                ...baseParams,
                mode: 'attach',
                matchedRecipe: { id: 42, uuid: 'existing-uuid' }
            }
        });

        if (result.ok) {
            expect(result.shouldCreateRecipe).toBe(false);
            expect(notifyNewRecipeMock).not.toHaveBeenCalled();
        }
    });
});
```

Note: `prepareRecipeUploadAction` has substantial DB surface (fingerprint dedupe lookup, `createRecipeWithSettings`, image insert). Rather than re-deriving every mock shape here, base the `db/index.ts` mock in this test file on the one already in `tests/prepare-recipe-upload.test.js` — copy it, then add the `notifyNewRecipe` assertion on top. If that existing test file already covers the "recipe created" and "attached to existing recipe" cases, it is acceptable to instead add the `notifyNewRecipe` assertions directly into `tests/prepare-recipe-upload.test.js` next to those existing cases instead of creating a new file — check that file's contents first and prefer extending it if the cases already exist.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/prepare-upload-notify-new-recipe.test.js` (or the extended `tests/prepare-recipe-upload.test.js`)
Expected: FAIL — `notifyNewRecipe` is not called yet.

- [ ] **Step 4: Wire the call in `app/upload/actions.js`**

Add the import next to the Task 5 import:

```js
import { notifyNewRecipe, notifySampleImageAdded } from '../../lib/notifications.js';
```

In `prepareRecipeUploadAction`, inside the `if (shouldCreateRecipe) { ... }` block, right after:

```js
            createdRecipeId = recipeRow.id;
            createdRecipeUuid = recipeRow.uuid;
```

add:

```js
            await notifyNewRecipe(createdRecipeId);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/prepare-upload-notify-new-recipe.test.js` (or the extended file)
Expected: PASS

- [ ] **Step 6: Run the full existing prepare-upload test to confirm no regression**

Run: `npx vitest run tests/prepare-recipe-upload.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/upload/actions.js tests/prepare-upload-notify-new-recipe.test.js tests/prepare-recipe-upload.test.js
git commit -m "feat(notifications): fan out new-recipe notifications on recipe creation"
```

---

### Task 7: `lib/notifications.js` — read helpers (bell data access)

**Files:**
- Modify: `lib/notifications.js`
- Test: `tests/notification-reads.test.js`

**Interfaces:**
- Produces: `getUnreadCount(userId): Promise<number>`, `getNotificationsForUser(userId, {limit}): Promise<Array<{id, uuid, type, readAt, createdAt, recipe: {id, slug, uuid, recipeName}, actorAuthorName}>>`, `markNotificationsRead(userId, {ids}): Promise<void>` (marks all unread when `ids` is omitted/empty).

- [ ] **Step 1: Write the failing tests**

```js
// tests/notification-reads.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let updateMock;
let getUnreadCount;
let getNotificationsForUser;
let markNotificationsRead;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

describe('notification read helpers', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        getUnreadCount = mod.getUnreadCount;
        getNotificationsForUser = mod.getNotificationsForUser;
        markNotificationsRead = mod.markNotificationsRead;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('counts unread notifications for a user', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 3 }]))
        }));

        await expect(getUnreadCount(9)).resolves.toBe(3);
    });

    it('lists recent notifications newest first, joined with recipe and actor name', async () => {
        const rows = [
            {
                id: 1,
                uuid: 'n-1',
                type: 'recipe_saved',
                readAt: null,
                createdAt: new Date('2026-08-20T00:00:00Z'),
                recipe: { id: 5, slug: 'golden-hour', uuid: 'r-uuid', recipeName: 'Golden Hour' },
                actorAuthorName: 'Jane'
            }
        ];
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(rows))
        }));

        await expect(getNotificationsForUser(9, { limit: 50 })).resolves.toEqual(rows);
    });

    it('marks all unread notifications read when no ids given', async () => {
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        await markNotificationsRead(9, {});

        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
    });

    it('marks only the given ids read when provided', async () => {
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        await markNotificationsRead(9, { ids: [1, 2] });

        expect(updateMock).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notification-reads.test.js`
Expected: FAIL — read helpers don't exist yet.

- [ ] **Step 3: Append the read helpers to `lib/notifications.js`**

By this point `lib/notifications.js` already has a `drizzle-orm` import (`asc, eq` from Task 3) and a `../db/schema.ts` import (`authors, notificationPreferences, notifications, recipes` from Task 3). Merge into those same two lines rather than adding new ones, so the file ends up with exactly one `drizzle-orm` import line reading:

```js
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
```

and one `../db/schema.ts` import line (unchanged from Task 3, already covers everything this task needs):

```js
import { authors, notificationPreferences, notifications, recipes } from '../db/schema.ts';
```

Append:

```js
export async function getUnreadCount(userId) {
    const rows = await db
        .select({ value: sql`count(*)`.mapWith(Number) })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));

    return rows[0]?.value ?? 0;
}

export async function getNotificationsForUser(userId, { limit = 50 } = {}) {
    return db
        .select({
            id: notifications.id,
            uuid: notifications.uuid,
            type: notifications.type,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
            recipe: {
                id: recipes.id,
                slug: recipes.slug,
                uuid: recipes.uuid,
                recipeName: recipes.recipeName
            },
            actorAuthorName: authors.name
        })
        .from(notifications)
        .innerJoin(recipes, eq(recipes.id, notifications.recipeId))
        .leftJoin(authors, eq(authors.id, notifications.actorAuthorId))
        .where(eq(notifications.recipientUserId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
}

export async function markNotificationsRead(userId, { ids } = {}) {
    const condition =
        Array.isArray(ids) && ids.length > 0
            ? and(eq(notifications.recipientUserId, userId), inArray(notifications.id, ids), isNull(notifications.readAt))
            : and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt));

    await db.update(notifications).set({ readAt: new Date() }).where(condition);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notification-reads.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.js tests/notification-reads.test.js
git commit -m "feat(notifications): add unread-count, list, and mark-read helpers"
```

---

### Task 8: API routes for the bell (`GET /api/notifications`, `POST /api/notifications/read`)

**Files:**
- Create: `app/api/notifications/route.js`
- Create: `app/api/notifications/read/route.js`
- Test: `tests/notifications-api-routes.test.js`

**Interfaces:**
- Consumes: `requireUser()` from `../../../lib/auth.js` (and `../../../../lib/auth.js` for the nested route); `getNotificationsForUser`, `getUnreadCount`, `markNotificationsRead` from `lib/notifications.js`.
- Produces: `GET /api/notifications` → `{ items, unreadCount }` (401 JSON if unauthenticated); `POST /api/notifications/read` → `{ ok: true }` (401 JSON if unauthenticated), accepts optional `{ ids: number[] }` body.

- [ ] **Step 1: Write the failing tests**

```js
// tests/notifications-api-routes.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

let requireUserMock;
let getNotificationsForUserMock;
let getUnreadCountMock;
let markNotificationsReadMock;
let GET;
let POST;

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    getNotificationsForUser: (...args) => getNotificationsForUserMock(...args),
    getUnreadCount: (...args) => getUnreadCountMock(...args),
    markNotificationsRead: (...args) => markNotificationsReadMock(...args)
}));

describe('notifications API routes', () => {
    beforeEach(async () => {
        vi.resetModules();
        const listMod = await import('../app/api/notifications/route.js');
        const readMod = await import('../app/api/notifications/read/route.js');
        GET = listMod.GET;
        POST = readMod.POST;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('GET /api/notifications', () => {
        it('returns 401 when not authenticated', async () => {
            requireUserMock = vi.fn(() => Promise.reject(new Error('Not authenticated')));

            const response = await GET();

            expect(response.status).toBe(401);
        });

        it('returns items and unread count for an authenticated user', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            getNotificationsForUserMock = vi.fn(() => Promise.resolve([{ id: 1 }]));
            getUnreadCountMock = vi.fn(() => Promise.resolve(1));

            const response = await GET();

            expect(getNotificationsForUserMock).toHaveBeenCalledWith(9, { limit: 50 });
            expect(getUnreadCountMock).toHaveBeenCalledWith(9);
            await expect(response.json()).resolves.toEqual({ items: [{ id: 1 }], unreadCount: 1 });
        });
    });

    describe('POST /api/notifications/read', () => {
        it('returns 401 when not authenticated', async () => {
            requireUserMock = vi.fn(() => Promise.reject(new Error('Not authenticated')));

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(response.status).toBe(401);
        });

        it('marks all unread when no ids are given', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            markNotificationsReadMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadMock).toHaveBeenCalledWith(9, { ids: undefined });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });

        it('marks only the given ids when provided', async () => {
            requireUserMock = vi.fn(() => Promise.resolve({ user: { id: 9 } }));
            markNotificationsReadMock = vi.fn(() => Promise.resolve());

            const request = new NextRequest('https://www.omrecipes.dev/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({ ids: [1, 2, 'x'] }),
                headers: { 'content-type': 'application/json' }
            });
            const response = await POST(request);

            expect(markNotificationsReadMock).toHaveBeenCalledWith(9, { ids: [1, 2] });
            await expect(response.json()).resolves.toEqual({ ok: true });
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notifications-api-routes.test.js`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Write `app/api/notifications/route.js`**

```js
import { requireUser } from '../../../lib/auth.js';
import { getNotificationsForUser, getUnreadCount } from '../../../lib/notifications.js';

export async function GET() {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const [items, unreadCount] = await Promise.all([
        getNotificationsForUser(session.user.id, { limit: 50 }),
        getUnreadCount(session.user.id)
    ]);

    return Response.json(
        { items, unreadCount },
        { headers: { 'cache-control': 'private, no-store, max-age=0' } }
    );
}
```

- [ ] **Step 4: Write `app/api/notifications/read/route.js`**

```js
import { requireUser } from '../../../../lib/auth.js';
import { markNotificationsRead } from '../../../../lib/notifications.js';

export async function POST(request) {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
        ? body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : undefined;

    await markNotificationsRead(session.user.id, { ids });

    return Response.json({ ok: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/notifications-api-routes.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add app/api/notifications/route.js app/api/notifications/read/route.js tests/notifications-api-routes.test.js
git commit -m "feat(notifications): add bell API routes (list + mark read)"
```

---

### Task 9: `NotificationBell` component, wired into the header

**Files:**
- Create: `components/NotificationBell.jsx`
- Modify: `components/HeaderNav.jsx`

**Interfaces:**
- Consumes: `GET /api/notifications`, `POST /api/notifications/read` (Task 8); `getRecipePath` from `lib/recipe-url.js`; `cn` from `lib/cn`; `buttonVariants` from `components/ui/button`.
- Produces: default export `NotificationBell` — a self-contained client component with no required props, rendered only when the viewer is logged in.

This task is UI-only; there is no meaningful unit test for the polling/dropdown behavior given this codebase's Vitest setup (`environment: 'node'`, no jsdom/testing-library dependency present). Verify manually per Step 4.

- [ ] **Step 1: Create `components/NotificationBell.jsx`**

```jsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from 'lib/cn';
import { buttonVariants } from 'components/ui/button';
import { getRecipePath } from 'lib/recipe-url.js';

function describeNotification(item) {
    const recipeName = item.recipe?.recipeName ?? 'a recipe';
    const actorName = item.actorAuthorName ?? 'Someone';

    if (item.type === 'sample_image_added') return `${actorName} added a sample image to ${recipeName}`;
    if (item.type === 'recipe_saved') return `${actorName} saved ${recipeName}`;
    if (item.type === 'new_recipe') return `New recipe: ${recipeName} by ${actorName}`;
    return recipeName;
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [items, setItems] = useState([]);
    const containerRef = useRef(null);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch('/api/notifications', { cache: 'no-store' });
            if (!response.ok) return null;
            const data = await response.json();
            setItems(data.items ?? []);
            setUnreadCount(data.unreadCount ?? 0);
            setLoaded(true);
            return data;
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        void refresh();
        const interval = setInterval(refresh, 60000);
        return () => clearInterval(interval);
    }, [refresh]);

    useEffect(() => {
        if (!open) return undefined;

        function handleClickOutside(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const handleToggle = async () => {
        const next = !open;
        setOpen(next);
        if (!next) return;

        const data = await refresh();
        if (data && data.unreadCount > 0) {
            setUnreadCount(0);
            fetch('/api/notifications/read', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
            }).catch(() => {});
        }
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={handleToggle}
                aria-label="Notifications"
                aria-expanded={open}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
            >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                        d="M10 2a5 5 0 0 0-5 5v2.5c0 .7-.25 1.38-.7 1.92L3 13h14l-1.3-1.58c-.45-.54-.7-1.22-.7-1.92V7a5 5 0 0 0-5-5Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                    />
                    <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {unreadCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                ) : null}
            </button>

            {open ? (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-border/70 bg-card p-2 shadow-lg">
                    {!loaded ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
                    ) : items.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">No notifications yet.</p>
                    ) : (
                        <ul className="max-h-96 overflow-y-auto">
                            {items.map((item) => (
                                <li key={item.id}>
                                    <Link
                                        href={item.recipe ? getRecipePath(item.recipe) : '/'}
                                        onClick={() => setOpen(false)}
                                        className="block rounded-lg px-3 py-2 text-sm text-foreground no-underline hover:bg-accent/60"
                                    >
                                        {describeNotification(item)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 2: Wire it into `components/HeaderNav.jsx`**

Add the import at the top:

```js
import NotificationBell from 'components/NotificationBell';
```

Change the return statement from:

```jsx
    return (
        <>
            <div className="nav-desktop items-center gap-4">
```

to:

```jsx
    return (
        <>
            {isLoggedIn ? <NotificationBell /> : null}
            <div className="nav-desktop items-center gap-4">
```

(leave the rest of the return block — including the `nav-mobile` / `MobileMenu` block — unchanged; the bell renders once, outside both the desktop and mobile-only wrappers, so it is visible at every breakpoint).

- [ ] **Step 3: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS (no existing test imports `HeaderNav.jsx` under Vitest's node environment, so this is a compile-sanity check via `npm run build` in Step 4, not a unit-test regression risk)

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`, then in a browser:
1. Log in as a test user (magic link or existing session).
2. Confirm the bell icon appears in the header (desktop width and mobile width).
3. With zero notifications, open the panel and confirm the "No notifications yet." empty state.
4. Trigger a real notification (e.g. save a recipe you don't own from a second account, or have a second account save one of your recipes) and confirm the badge count appears within 60s (or immediately on next page load) and the panel lists it with a working link to the recipe.
5. Open the panel and confirm the badge clears (marks read) and stays cleared on reopen.

- [ ] **Step 5: Commit**

```bash
git add components/NotificationBell.jsx components/HeaderNav.jsx
git commit -m "feat(notifications): add bell icon with unread badge and panel to the header"
```

---

### Task 10: Owner-only save-count display

**Files:**
- Modify: `lib/recipe-saves.js`
- Modify: `app/recipes/[id]/page.jsx`
- Modify: `components/recipe-card.jsx`
- Test: `tests/recipe-save-count.test.js`

**Interfaces:**
- Produces: `getSaveCountForRecipe(recipeId): Promise<number>` in `lib/recipe-saves.js`. `RecipeCard` gains an optional `saveCount` prop (number or null), rendered only when `isOwner` is also true.

- [ ] **Step 1: Write the failing test**

```js
// tests/recipe-save-count.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSaveCountForRecipe;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: vi.fn(() => Promise.resolve())
}));

describe('getSaveCountForRecipe', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        getSaveCountForRecipe = mod.getSaveCountForRecipe;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the count of saves for a recipe', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 4 }]))
        }));

        await expect(getSaveCountForRecipe(5)).resolves.toBe(4);
    });

    it('returns 0 when there are no saves', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 0 }]))
        }));

        await expect(getSaveCountForRecipe(5)).resolves.toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recipe-save-count.test.js`
Expected: FAIL — `getSaveCountForRecipe` doesn't exist yet.

- [ ] **Step 3: Add `getSaveCountForRecipe` to `lib/recipe-saves.js`**

Add `sql` to the existing `drizzle-orm` import:

```js
import { and, eq, inArray, sql } from 'drizzle-orm';
```

Append the new function (anywhere after `recipeExists`):

```js
export async function getSaveCountForRecipe(recipeId) {
    const normalizedRecipeId = Number(recipeId);
    if (!Number.isFinite(normalizedRecipeId)) return 0;

    const rows = await db
        .select({ value: sql`count(*)`.mapWith(Number) })
        .from(savedRecipes)
        .where(eq(savedRecipes.recipeId, normalizedRecipeId));

    return rows[0]?.value ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recipe-save-count.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into the recipe detail page**

In `app/recipes/[id]/page.jsx`, add `getSaveCountForRecipe` to the existing import:

```js
import { getSavedRecipeIdsForUser, getSaveCountForRecipe } from '../../../lib/recipe-saves.js';
```

In the `Page` component, after:

```js
    const authedAuthorIds = await getAuthedAuthorIds(userId);
    const isOwner = authedAuthorIds.includes(recipe.authorId);
```

add:

```js
    const saveCount = isOwner ? await getSaveCountForRecipe(recipe.id) : null;
```

Then pass it to `RecipeCard`:

```jsx
                <RecipeCard
                    recipe={recipe}
                    isOwner={isOwner}
                    saveCount={saveCount}
                    updateRecipeAction={updateRecipeAction}
                    deleteRecipeAction={deleteMyRecipeAction}
                />
```

- [ ] **Step 6: Render it in `components/recipe-card.jsx`**

Add `saveCount = null` to the destructured props (after `isOwner = false,`):

```jsx
export default function RecipeCard({
  recipe,
  isOwner = false,
  saveCount = null,
  updateRecipeAction,
  deleteRecipeAction,
  onSavedChange,
  selectedImageOption = SAMPLE_IMAGE_SELECTION
}) {
```

In the badge row (around the existing `Recipe` / type / camera / filmSimulation badges), add the owner-only save count immediately after `filmSimulation`:

```jsx
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Recipe</Badge>
                <Badge variant="outline">{recipeType === 'MONO' ? 'Monochrome' : 'Color'}</Badge>
                {recipe?.camera ? <Badge variant="outline">{recipe.camera}</Badge> : null}
                {recipe?.filmSimulation ? <Badge variant="outline">{recipe.filmSimulation}</Badge> : null}
                {isOwner && typeof saveCount === 'number' ? (
                  <Badge variant="outline">Saved {saveCount} {saveCount === 1 ? 'time' : 'times'}</Badge>
                ) : null}
              </div>
```

- [ ] **Step 7: Run the recipe-detail-page test to confirm no regression**

Run: `npx vitest run tests/recipe-detail-page.test.js tests/recipe-card.test.js`
Expected: PASS

- [ ] **Step 8: Manual browser verification**

Run: `npm run dev`. As the owner of a recipe with at least one save, open that recipe's detail page and confirm "Saved N times" appears in the badge row. Open the same recipe as a different (non-owner) logged-in user and confirm the badge does **not** appear.

- [ ] **Step 9: Commit**

```bash
git add lib/recipe-saves.js app/recipes/\[id\]/page.jsx components/recipe-card.jsx tests/recipe-save-count.test.js
git commit -m "feat(notifications): show owner-only save count on the recipe detail page"
```

---

### Task 11: Preferences UI on the profile page

**Files:**
- Modify: `app/profile/actions.js`
- Create: `app/profile/notifications-form.jsx`
- Modify: `app/profile/page.jsx`
- Test: `tests/notification-preferences-action.test.js`

**Interfaces:**
- Consumes: `getEffectivePreferences`, `upsertNotificationPreferences` from `../../lib/notifications.js` (Task 2).
- Produces: `updateMyNotificationPreferencesAction(formData)` server action.

- [ ] **Step 1: Write the failing test**

```js
// tests/notification-preferences-action.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let upsertNotificationPreferencesMock;
let revalidatePathMock;
let updateMyNotificationPreferencesAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'owner@example.com' } }),
    findOrCreateAuthorForUser: vi.fn(),
    clearSessionCookie: vi.fn()
}));

vi.mock('../lib/notifications.js', () => ({
    upsertNotificationPreferences: (...args) => upsertNotificationPreferencesMock(...args)
}));

vi.mock('../lib/privacy.js', () => ({
    startAccountDeletion: vi.fn(),
    startPrivacyExport: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve())
}));

vi.mock('../db/index.ts', () => ({
    db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })) }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

describe('updateMyNotificationPreferencesAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        upsertNotificationPreferencesMock = vi.fn(() => Promise.resolve());
        revalidatePathMock = vi.fn();
        const mod = await import('../app/profile/actions.js');
        updateMyNotificationPreferencesAction = mod.updateMyNotificationPreferencesAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('maps checked boxes to true and unchecked to false', async () => {
        const formData = new FormData();
        formData.set('notifySampleImage', 'on');
        formData.set('emailDigestEnabled', 'on');
        // notifyNewRecipe and notifySave intentionally omitted (unchecked boxes are absent from FormData)

        await updateMyNotificationPreferencesAction(formData);

        expect(upsertNotificationPreferencesMock).toHaveBeenCalledWith(9, {
            notifyNewRecipe: false,
            notifySampleImage: true,
            notifySave: false,
            emailDigestEnabled: true
        });
        expect(revalidatePathMock).toHaveBeenCalledWith('/profile');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notification-preferences-action.test.js`
Expected: FAIL — the action doesn't exist yet.

- [ ] **Step 3: Add the server action to `app/profile/actions.js`**

Add to the imports:

```js
import { upsertNotificationPreferences } from '../../lib/notifications.js';
```

Append the action:

```js
export async function updateMyNotificationPreferencesAction(formData) {
    const session = await requireUser();

    await upsertNotificationPreferences(session.user.id, {
        notifyNewRecipe: formData?.has('notifyNewRecipe'),
        notifySampleImage: formData?.has('notifySampleImage'),
        notifySave: formData?.has('notifySave'),
        emailDigestEnabled: formData?.has('emailDigestEnabled')
    });

    revalidatePath('/profile');
}
```

(Unchecked HTML checkboxes are absent from `FormData` entirely, so `formData.has(name)` is exactly "was this box checked".)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notification-preferences-action.test.js`
Expected: PASS

- [ ] **Step 5: Create `app/profile/notifications-form.jsx`**

```jsx
'use client';

import { SubmitButton } from 'components/submit-button';

export function NotificationPreferencesForm({ action, initialValues }) {
    return (
        <form action={action} className="flex flex-col gap-4">
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifyNewRecipe"
                    defaultChecked={initialValues.notifyNewRecipe}
                    className="h-4 w-4 rounded border-input"
                />
                Notify me about new recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifySampleImage"
                    defaultChecked={initialValues.notifySampleImage}
                    className="h-4 w-4 rounded border-input"
                />
                New sample images on my recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifySave"
                    defaultChecked={initialValues.notifySave}
                    className="h-4 w-4 rounded border-input"
                />
                Saves on my recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="emailDigestEnabled"
                    defaultChecked={initialValues.emailDigestEnabled}
                    className="h-4 w-4 rounded border-input"
                />
                Email me a daily digest
            </label>
            <div className="pt-2">
                <SubmitButton text="Save notification preferences" />
            </div>
        </form>
    );
}
```

- [ ] **Step 6: Wire it into `app/profile/page.jsx`**

Add imports:

```js
import { getEffectivePreferences } from '../../lib/notifications.js';
import { updateMyNotificationPreferencesAction } from './actions';
import { NotificationPreferencesForm } from './notifications-form';
```

(the `updateMyNotificationPreferencesAction` import merges into the existing `from './actions'` import line.)

After fetching `privacyRequests`, add:

```js
    const notificationPreferences = await getEffectivePreferences(user.id);
```

Insert a new Card between the existing Profile card and the Privacy controls card:

```jsx
            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Notifications</CardTitle>
                    <CardDescription>
                        Choose what you hear about in the bell icon and in your daily email digest.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <NotificationPreferencesForm
                        action={updateMyNotificationPreferencesAction}
                        initialValues={notificationPreferences}
                    />
                </CardContent>
            </Card>
```

- [ ] **Step 7: Run the profile-related tests to confirm no regression**

Run: `npx vitest run tests/notification-preferences-action.test.js`
Expected: PASS (there is no existing `profile-page.test.js` in `tests/` to check against — confirm with `ls tests | grep -i profile` before this step; if one exists, run it too)

- [ ] **Step 8: Manual browser verification**

Run: `npm run dev`, log in, visit `/profile`, confirm the Notifications card renders with the correct default checkbox states (new-recipe unchecked, the other three checked) for a first-time user, toggle a box, save, reload, and confirm the change persisted.

- [ ] **Step 9: Commit**

```bash
git add app/profile/actions.js app/profile/notifications-form.jsx app/profile/page.jsx tests/notification-preferences-action.test.js
git commit -m "feat(notifications): add notification preferences UI to the profile page"
```

---

### Task 12: Unsubscribe token helpers and unsubscribe page

**Files:**
- Modify: `lib/notifications.js`
- Create: `app/notifications/unsubscribe/page.jsx`
- Test: `tests/notification-unsubscribe.test.js`

**Interfaces:**
- Produces: `buildUnsubscribeToken(userUuid): string`, `verifyUnsubscribeToken(userUuid, token): boolean`, `unsubscribeFromEmailDigest({ userUuid, token }): Promise<void>` (throws on invalid token or unknown user) in `lib/notifications.js`. Task 13 (digest) calls `buildUnsubscribeToken`. The page calls `unsubscribeFromEmailDigest`.
- Requires a new env var `NOTIFICATIONS_UNSUBSCRIBE_SECRET` (any non-empty string; document it wherever the project's other required env vars — e.g. `OCI_EMAIL_SENDER` — are documented, if such a place exists; otherwise note it for the user in the session handoff).

- [ ] **Step 1: Write the failing tests**

```js
// tests/notification-unsubscribe.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let buildUnsubscribeToken;
let verifyUnsubscribeToken;
let unsubscribeFromEmailDigest;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

describe('unsubscribe token', () => {
    beforeEach(async () => {
        vi.resetModules();
        process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET = 'test-secret';
        const mod = await import('../lib/notifications.js');
        buildUnsubscribeToken = mod.buildUnsubscribeToken;
        verifyUnsubscribeToken = mod.verifyUnsubscribeToken;
        unsubscribeFromEmailDigest = mod.unsubscribeFromEmailDigest;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    });

    it('is deterministic for the same user uuid', () => {
        const a = buildUnsubscribeToken('user-uuid-1');
        const b = buildUnsubscribeToken('user-uuid-1');
        expect(a).toBe(b);
    });

    it('differs for different user uuids', () => {
        expect(buildUnsubscribeToken('user-uuid-1')).not.toBe(buildUnsubscribeToken('user-uuid-2'));
    });

    it('verifies a valid token and rejects an invalid one', () => {
        const token = buildUnsubscribeToken('user-uuid-1');
        expect(verifyUnsubscribeToken('user-uuid-1', token)).toBe(true);
        expect(verifyUnsubscribeToken('user-uuid-1', 'wrong-token')).toBe(false);
        expect(verifyUnsubscribeToken('user-uuid-1', '')).toBe(false);
    });

    it('flips emailDigestEnabled off for a valid token without requiring login', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ id: 9 }]))
        }));
        const onConflictDoUpdate = vi.fn(() => Promise.resolve());
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        insertMock = vi.fn(() => ({ values }));

        const token = buildUnsubscribeToken('user-uuid-1');
        await unsubscribeFromEmailDigest({ userUuid: 'user-uuid-1', token });

        expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, emailDigestEnabled: false }));
    });

    it('rejects an invalid token', async () => {
        await expect(
            unsubscribeFromEmailDigest({ userUuid: 'user-uuid-1', token: 'wrong' })
        ).rejects.toThrow('Invalid or expired unsubscribe link');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notification-unsubscribe.test.js`
Expected: FAIL — the token helpers don't exist yet.

- [ ] **Step 3: Append the unsubscribe helpers to `lib/notifications.js`**

Add to the top imports:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import { users } from '../db/schema.ts';
```

(merge `users` into the existing `../db/schema.ts` import line rather than duplicating it.)

Append:

```js
function unsubscribeSecret() {
    const secret = process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    if (!secret) throw new Error('Missing NOTIFICATIONS_UNSUBSCRIBE_SECRET env var');
    return secret;
}

export function buildUnsubscribeToken(userUuid) {
    return createHmac('sha256', unsubscribeSecret()).update(String(userUuid)).digest('base64url');
}

export function verifyUnsubscribeToken(userUuid, token) {
    if (!token) return false;

    const expected = Buffer.from(buildUnsubscribeToken(userUuid));
    const provided = Buffer.from(String(token));
    if (expected.length !== provided.length) return false;

    return timingSafeEqual(expected, provided);
}

export async function unsubscribeFromEmailDigest({ userUuid, token }) {
    if (!verifyUnsubscribeToken(userUuid, token)) {
        throw new Error('Invalid or expired unsubscribe link');
    }

    const userRows = await db.select({ id: users.id }).from(users).where(eq(users.uuid, userUuid)).limit(1);
    const user = userRows[0];
    if (!user) {
        throw new Error('Invalid or expired unsubscribe link');
    }

    await db
        .insert(notificationPreferences)
        .values({ userId: user.id, ...NOTIFICATION_PREFERENCE_DEFAULTS, emailDigestEnabled: false })
        .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { emailDigestEnabled: false, updatedAt: new Date() }
        });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notification-unsubscribe.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Create the unsubscribe page**

```jsx
// app/notifications/unsubscribe/page.jsx
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.jsx';
import { buttonVariants } from '../../../components/ui/button.jsx';
import { unsubscribeFromEmailDigest } from '../../../lib/notifications.js';

export const metadata = {
    title: 'Unsubscribe'
};

export default async function Page({ searchParams }) {
    const resolvedSearchParams = await searchParams;
    const userUuid = String(resolvedSearchParams?.uid ?? '').trim();
    const token = String(resolvedSearchParams?.token ?? '').trim();

    let error = null;
    if (!userUuid || !token) {
        error = 'This unsubscribe link is missing required information.';
    } else {
        try {
            await unsubscribeFromEmailDigest({ userUuid, token });
        } catch (e) {
            error = e?.message || 'This unsubscribe link is invalid or has expired.';
        }
    }

    return (
        <Card className="max-w-xl">
            <CardHeader>
                <CardTitle>{error ? 'Unsubscribe failed' : "You're unsubscribed"}</CardTitle>
                <CardDescription>
                    {error ?? 'You will no longer receive the daily email digest from OM Recipes. You can still see notifications in the bell icon, and can re-enable email any time from your profile.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Link href="/profile" className={buttonVariants({ variant: 'outline' })}>
                    Manage notification preferences
                </Link>
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/notifications.js app/notifications/unsubscribe/page.jsx tests/notification-unsubscribe.test.js
git commit -m "feat(notifications): add signed one-click unsubscribe link and confirmation page"
```

---

### Task 13: Digest builder — eligible users, email composition, mark-after-send

**Files:**
- Modify: `lib/oci/emailDelivery.js`
- Modify: `lib/notifications.js`
- Test: `tests/oci-email-headers.test.js`
- Test: `tests/notification-digest.test.js`

**Interfaces:**
- Produces (in `lib/notifications.js`): `isSixPmEastern(date = new Date()): boolean`, `getUsersEligibleForDigest(): Promise<Array<{userId, uuid, email}>>`, `sendDailyDigestForUser({userId, uuid, email}): Promise<{sent: boolean, count: number}>`, `runDailyDigest(): Promise<{eligibleUsers, sent, failed}>`. Task 14 (the Netlify function) calls `isSixPmEastern` and `runDailyDigest`.
- Consumes: `sendEmail` from `./oci/emailDelivery.js` (dynamically imported, matching `sendMagicLinkEmail`'s existing pattern); `publicAppBaseUrl` from `./auth-url.js`; `buildUnsubscribeToken` from Task 12 (same file).

- [ ] **Step 1: Write the failing test for the `sendEmail` header pass-through**

```js
// tests/oci-email-headers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = global.fetch;

describe('sendEmail optional headers', () => {
    beforeEach(() => {
        process.env.OCI_TENANCY_OCID = 't';
        process.env.OCI_USER_OCID = 'u';
        process.env.OCI_FINGERPRINT = 'f';
        process.env.OCI_PRIVATE_KEY_B64 = Buffer.from('key').toString('base64');
        process.env.OCI_REGION = 'us-ashburn-1';
        process.env.OCI_EMAIL_DELIVERY_ENDPOINT = 'https://email.example.com';
        process.env.OCI_EMAIL_SENDER = 'noreply@example.com';
        process.env.OCI_EMAIL_DELIVERY_COMPARTMENT_OCID = 'compartment';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('includes a headers field in the submitEmail payload when provided', async () => {
        let capturedBody;
        vi.spyOn(await import('oci-common'), 'FetchHttpClient').mockImplementation(() => ({
            send: async ({ body }) => {
                capturedBody = body;
                return { ok: true, text: async () => '' };
            }
        }));

        const { sendEmail } = await import('../lib/oci/emailDelivery.js');
        await sendEmail({
            to: 'user@example.com',
            subject: 'Subject',
            text: 'Body',
            headers: { 'List-Unsubscribe': '<https://example.com/unsub>' }
        });

        const parsed = JSON.parse(capturedBody);
        expect(parsed.headers).toEqual({ 'List-Unsubscribe': '<https://example.com/unsub>' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/oci-email-headers.test.js`
Expected: FAIL — `sendEmail` does not accept/forward `headers` yet. (If mocking `oci-common`'s `FetchHttpClient` this way doesn't intercept cleanly given how `emailDelivery.js` imports it, adjust the mock to `vi.mock('oci-common', ...)` with a factory instead of `vi.spyOn` post-import — check `tests/` for any existing OCI-mocking precedent with `grep -l "oci-common" tests/*.test.js` first and follow it if one exists.)

- [ ] **Step 3: Extend `sendEmail` in `lib/oci/emailDelivery.js`**

Change the function signature from:

```js
export async function sendEmail({
    to,
    subject,
    html,
    text,
    sender = process.env.OCI_EMAIL_SENDER,
    compartmentId = process.env.OCI_EMAIL_DELIVERY_COMPARTMENT_OCID
}) {
```

to:

```js
export async function sendEmail({
    to,
    subject,
    html,
    text,
    headers,
    sender = process.env.OCI_EMAIL_SENDER,
    compartmentId = process.env.OCI_EMAIL_DELIVERY_COMPARTMENT_OCID
}) {
```

Change the payload construction from:

```js
    const payload = JSON.stringify({
        sender: {
            compartmentId,
            senderAddress: {
                email: sender,
            }
        },
        recipients: {
            to: [{ email: to }]
        },
        subject,
        bodyHtml: html || undefined,
        bodyText: text || undefined
    }, null, 2);
```

to:

```js
    const payload = JSON.stringify({
        sender: {
            compartmentId,
            senderAddress: {
                email: sender,
            }
        },
        recipients: {
            to: [{ email: to }]
        },
        subject,
        bodyHtml: html || undefined,
        bodyText: text || undefined,
        headers: headers && Object.keys(headers).length > 0 ? headers : undefined
    }, null, 2);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/oci-email-headers.test.js`
Expected: PASS

- [ ] **Step 5: Run the existing email-dependent tests to confirm no regression**

Run: `npx vitest run` (search first with `grep -rl "emailDelivery" tests/*.test.js` for anything exercising `sendEmail` directly and run those specifically too)
Expected: PASS

- [ ] **Step 6: Write the failing digest test**

```js
// tests/notification-digest.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let selectDistinctMock;
let updateMock;
let sendEmailMock;
let isSixPmEastern;
let getUsersEligibleForDigest;
let sendDailyDigestForUser;
let runDailyDigest;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        selectDistinct: (...args) => selectDistinctMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('../lib/oci/emailDelivery.js', () => ({
    sendEmail: (...args) => sendEmailMock(...args)
}));

vi.mock('../lib/auth-url.js', () => ({
    publicAppBaseUrl: () => 'https://www.omrecipes.dev'
}));

describe('daily digest', () => {
    beforeEach(async () => {
        vi.resetModules();
        process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET = 'test-secret';
        sendEmailMock = vi.fn(() => Promise.resolve());
        const mod = await import('../lib/notifications.js');
        isSixPmEastern = mod.isSixPmEastern;
        getUsersEligibleForDigest = mod.getUsersEligibleForDigest;
        sendDailyDigestForUser = mod.sendDailyDigestForUser;
        runDailyDigest = mod.runDailyDigest;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    });

    describe('isSixPmEastern', () => {
        it('is true at 6pm Eastern Daylight Time', () => {
            // 2026-08-21 18:00 EDT == 22:00 UTC
            expect(isSixPmEastern(new Date('2026-08-21T22:00:00Z'))).toBe(true);
        });

        it('is true at 6pm Eastern Standard Time', () => {
            // 2026-01-21 18:00 EST == 23:00 UTC
            expect(isSixPmEastern(new Date('2026-01-21T23:00:00Z'))).toBe(true);
        });

        it('is false at other hours', () => {
            expect(isSixPmEastern(new Date('2026-08-21T12:00:00Z'))).toBe(false);
        });
    });

    it('sends a grouped digest and marks only the sent rows emailed', async () => {
        const pendingRows = [
            { id: 1, type: 'recipe_saved' },
            { id: 2, type: 'recipe_saved' },
            { id: 3, type: 'sample_image_added' }
        ];
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve(pendingRows))
        }));
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        const result = await sendDailyDigestForUser({ userId: 9, uuid: 'user-uuid-1', email: 'owner@example.com' });

        expect(result).toEqual({ sent: true, count: 3 });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const call = sendEmailMock.mock.calls[0][0];
        expect(call.to).toBe('owner@example.com');
        expect(call.subject).toContain('2 saves');
        expect(call.html).toContain('unsubscribe');
        expect(call.headers).toEqual(expect.objectContaining({ 'List-Unsubscribe': expect.stringContaining('unsubscribe') }));
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ emailedAt: expect.any(Date) }));
    });

    it('does nothing and does not send when there is nothing pending', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([]))
        }));

        const result = await sendDailyDigestForUser({ userId: 9, uuid: 'user-uuid-1', email: 'owner@example.com' });

        expect(result).toEqual({ sent: false, count: 0 });
        expect(sendEmailMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/notification-digest.test.js`
Expected: FAIL — `isSixPmEastern`, `getUsersEligibleForDigest`, `sendDailyDigestForUser`, `runDailyDigest` don't exist yet.

- [ ] **Step 8: Append the digest builder to `lib/notifications.js`**

By this point the file has one `drizzle-orm` import line (`and, asc, desc, eq, inArray, isNull, sql` from Task 7). Merge `isNotNull` and `or` into that same line so it reads:

```js
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
```

Add a new import line for `publicAppBaseUrl`:

```js
import { publicAppBaseUrl } from './auth-url.js';
```

Append:

```js
export function isSixPmEastern(date = new Date()) {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false
    }).format(date);

    return Number(hour) === 18;
}

export async function getUsersEligibleForDigest() {
    return db
        .selectDistinct({
            userId: users.id,
            uuid: users.uuid,
            email: users.email
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientUserId))
        .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
        .where(
            and(
                isNull(notifications.emailedAt),
                isNotNull(users.emailVerifiedAt),
                or(isNull(notificationPreferences.emailDigestEnabled), eq(notificationPreferences.emailDigestEnabled, true))
            )
        );
}

const DIGEST_TYPE_ORDER = ['recipe_saved', 'sample_image_added', 'new_recipe'];

function pluralize(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function summarizeDigestCounts(counts) {
    const parts = [];
    if (counts.recipe_saved) parts.push(pluralize(counts.recipe_saved, 'save'));
    if (counts.sample_image_added) parts.push(`${pluralize(counts.sample_image_added, 'new sample image')} on your recipes`);
    if (counts.new_recipe) parts.push(pluralize(counts.new_recipe, 'new recipe'));
    return parts.join(', ');
}

export async function sendDailyDigestForUser({ userId, uuid, email }) {
    const pending = await db
        .select({ id: notifications.id, type: notifications.type })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.emailedAt)));

    if (pending.length === 0) return { sent: false, count: 0 };

    const counts = pending.reduce((acc, row) => {
        acc[row.type] = (acc[row.type] ?? 0) + 1;
        return acc;
    }, {});
    const summary = summarizeDigestCounts(counts);

    const baseUrl = publicAppBaseUrl();
    const token = buildUnsubscribeToken(uuid);
    const unsubscribeUrl = `${baseUrl}/notifications/unsubscribe?uid=${encodeURIComponent(uuid)}&token=${encodeURIComponent(token)}`;
    const manageUrl = `${baseUrl}/profile`;

    const { sendEmail } = await import('./oci/emailDelivery.js');
    await sendEmail({
        to: email,
        subject: `Today on OM Recipes: ${summary}`,
        text: `Today on OM Recipes: ${summary}.\n\nView your notifications: ${baseUrl}\n\nUnsubscribe from this digest: ${unsubscribeUrl}\nManage preferences: ${manageUrl}`,
        html: `<p>Today on OM Recipes: ${summary}.</p><p><a href="${baseUrl}">View your notifications</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a> · <a href="${manageUrl}">Manage preferences</a></p>`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` }
    });

    await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(
            and(
                eq(notifications.recipientUserId, userId),
                inArray(notifications.id, pending.map((row) => row.id))
            )
        );

    return { sent: true, count: pending.length };
}

export async function runDailyDigest() {
    const eligible = await getUsersEligibleForDigest();
    let sent = 0;
    let failed = 0;

    for (const user of eligible) {
        try {
            const result = await sendDailyDigestForUser(user);
            if (result.sent) sent += 1;
        } catch (error) {
            failed += 1;
            console.error('[notifications] digest send failed', { userId: user.userId, error });
        }
    }

    return { eligibleUsers: eligible.length, sent, failed };
}
```

`DIGEST_TYPE_ORDER` is unused by the summary builder above (the summary order is hardcoded to match the spec's example ordering) — remove that constant rather than leaving it dead; it's listed here only to flag that `summarizeDigestCounts`'s literal `if` order is the intended ordering, not `DIGEST_TYPE_ORDER`.

Also add `users` to the existing `../db/schema.ts` import if Task 12 didn't already add it (it did — just confirm it's there once, not duplicated).

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/notification-digest.test.js`
Expected: PASS (5 tests)

- [ ] **Step 10: Commit**

```bash
git add lib/oci/emailDelivery.js lib/notifications.js tests/oci-email-headers.test.js tests/notification-digest.test.js
git commit -m "feat(notifications): build grouped daily digest emails with mark-after-send and List-Unsubscribe"
```

---

### Task 14: Netlify scheduled function

**Files:**
- Create: `netlify/functions/notification-digest.js`

**Interfaces:**
- Consumes: `isSixPmEastern`, `runDailyDigest` from `../../lib/notifications.js` (Task 13).

There is no meaningful Vitest coverage for a Netlify scheduled-function handler itself (it's a thin wrapper); the logic it calls is already unit-tested in Task 13. Verify per Step 2.

- [ ] **Step 1: Create `netlify/functions/notification-digest.js`**

```js
import { schedule } from '@netlify/functions';
import { isSixPmEastern, runDailyDigest } from '../../lib/notifications.js';

export const handler = schedule('@hourly', async () => {
    if (!isSixPmEastern(new Date())) {
        return { statusCode: 200, body: 'skip: not 6pm Eastern' };
    }

    const summary = await runDailyDigest();
    console.log('[notification-digest]', summary);

    return { statusCode: 200, body: JSON.stringify(summary) };
});
```

- [ ] **Step 2: Verify the function is discovered**

Run: `netlify functions:list` (requires the Netlify CLI to be linked to this site; if it isn't linked in this environment, instead run `npx netlify build` locally and confirm the build log lists `notification-digest` as a scheduled function with cron `@hourly` — do not attempt to actually trigger a live schedule from this environment).

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/notification-digest.js
git commit -m "feat(notifications): add hourly scheduled function that sends the 6pm Eastern digest"
```

---

### Task 15: Privacy integration — export, deletion, retention pruning

**Files:**
- Modify: `lib/privacy.js`
- Modify: `lib/privacy-retention.js`
- Modify: `db/schema.ts` (import only, no new tables)
- Test: `tests/privacy-notifications.test.js`
- Test: extend `tests/privacy-retention.test.js`

**Interfaces:**
- Consumes: `notifications`, `notificationPreferences` from `../db/schema.ts`.
- Extends: `collectUserExportPayload` (adds `receivedNotifications` and `notificationPreferences` to the export payload), `eraseAccountData` (deletes the user's notification rows and preferences before deleting the user), `runPrivacyRetentionCleanup` (prunes notifications older than a configurable retention window), `getPrivacyRetentionConfig` (adds `notificationRetentionDays` / `notificationRetentionMs`, default 90 days, env var `NOTIFICATION_RETENTION_DAYS`).

- [ ] **Step 1: Write the failing retention-config test (extend the existing file)**

Add to `tests/privacy-retention.test.js`, inside the existing `describe` block, alongside the other assertions in the "returns defaults" and "parses configured override values" and "rejects invalid values" tests:

In the defaults test, add:

```js
        expect(config.notificationRetentionDays).toBe(90);
```

In the overrides test, add `NOTIFICATION_RETENTION_DAYS: '120'` to the input object and:

```js
        expect(config.notificationRetentionDays).toBe(120);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/privacy-retention.test.js`
Expected: FAIL — `notificationRetentionDays` is undefined.

- [ ] **Step 3: Add the config field to `lib/privacy-retention.js`**

Add alongside the other `parsePositiveInteger` calls in `getPrivacyRetentionConfig`:

```js
    const notificationRetentionDays = parsePositiveInteger(
        env.NOTIFICATION_RETENTION_DAYS,
        90,
        'NOTIFICATION_RETENTION_DAYS'
    );
```

Add to the returned object:

```js
        notificationRetentionDays,
        notificationRetentionMs: notificationRetentionDays * DAY_MS,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/privacy-retention.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing export/deletion/retention-cleanup tests**

```js
// tests/privacy-notifications.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let deleteMock;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

describe('privacy retention prunes old notifications', () => {
    beforeEach(async () => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('deletes notifications older than the retention cutoff', async () => {
        const deletedRows = { notifications: [{ id: 1 }, { id: 2 }] };
        const returningByCall = [
            [], // authMagicLinks
            [], // authSessions
            [], // expiredExports select
            [], // privacyRequests
            deletedRows.notifications, // notifications
            [] // abandonedUploads select
        ];
        let call = 0;
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([]))
        }));
        deleteMock = vi.fn(() => ({
            where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve(returningByCall[call++] ?? []))
            }))
        }));

        const { runPrivacyRetentionCleanup } = await import('../lib/privacy.js');
        const summary = await runPrivacyRetentionCleanup({ now: new Date('2026-08-21T00:00:00Z'), env: {} });

        expect(summary.deletedNotifications).toBe(2);
    });
});
```

Note: `runPrivacyRetentionCleanup` already issues several `db.delete(...)` calls in a fixed order (magic links, sessions, then a `db.select` for expired exports, then `db.delete(privacyRequests)`, then a `db.select` for abandoned uploads, then `db.delete(images)` conditionally). Read the current body of `runPrivacyRetentionCleanup` in `lib/privacy.js` again immediately before writing this test and match the mock's call-order array to whatever the real order is **after** Step 6 adds the new notifications-delete call — place the notifications deletion in the array at the position you actually insert it in Step 6 (recommended: right after the `authSessions`/`authMagicLinks` deletes, before the expired-exports handling, since it needs no prior state). Adjust `returningByCall` indices accordingly if they don't line up on the first run.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/privacy-notifications.test.js`
Expected: FAIL — `summary.deletedNotifications` is undefined.

- [ ] **Step 7: Wire notification pruning into `lib/privacy.js`**

Add `notifications` to the existing `../db/schema.ts` import list.

In `runPrivacyRetentionCleanup`, add a cutoff calculation near the other cutoffs:

```js
    const notificationCutoff = new Date(now.getTime() - config.notificationRetentionMs);
```

Add a deletion call — insert it right after the `deletedSessions` block and before the `expiredExports` query:

```js
    const deletedNotifications = await db
        .delete(notifications)
        .where(lt(notifications.createdAt, notificationCutoff))
        .returning({ id: notifications.id });
```

Add `deletedNotifications: deletedNotifications.length` to the object returned at the end of the function.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/privacy-notifications.test.js`
Expected: PASS

- [ ] **Step 9: Wire deletion-on-account-erasure into `eraseAccountData`**

Add `notificationPreferences` to the `../db/schema.ts` import list (alongside `notifications`, added in Step 7).

In `eraseAccountData`, add before `await db.delete(users).where(eq(users.id, userId));`:

```js
    await db.delete(notifications).where(eq(notifications.recipientUserId, userId));
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
```

- [ ] **Step 10: Wire export into `collectUserExportPayload`**

Add `notifications` and `notificationPreferences` to the `Promise.all` block that currently fetches `savedRows` / `modeAssignmentRows` (extend the existing `Promise.all([...])` array with two more queries):

```js
        db
            .select({
                type: notifications.type,
                recipeId: notifications.recipeId,
                recipeSlug: recipes.slug,
                recipeName: recipes.recipeName,
                readAt: notifications.readAt,
                createdAt: notifications.createdAt
            })
            .from(notifications)
            .innerJoin(recipes, eq(recipes.id, notifications.recipeId))
            .where(eq(notifications.recipientUserId, userId))
            .orderBy(desc(notifications.createdAt)),
        db
            .select({
                notifyNewRecipe: notificationPreferences.notifyNewRecipe,
                notifySampleImage: notificationPreferences.notifySampleImage,
                notifySave: notificationPreferences.notifySave,
                emailDigestEnabled: notificationPreferences.emailDigestEnabled
            })
            .from(notificationPreferences)
            .where(eq(notificationPreferences.userId, userId))
            .limit(1)
```

Capture the two new results (destructure two more variables from the `Promise.all` call site) and add them to the returned payload object:

```js
        receivedNotifications: notificationRows,
        notificationPreferences: notificationPreferenceRows[0] ?? null,
```

(Name the destructured variables `notificationRows` and `notificationPreferenceRows` to match; adjust the destructuring assignment that currently reads `const [savedRows, modeAssignmentRows] = ...` — find its exact current variable list in `lib/privacy.js` before editing, since Step 9's insertion into the `Promise.all` array must line up positionally with the destructuring on the left-hand side.)

- [ ] **Step 11: Add an export test**

Extend `tests/privacy-notifications.test.js` with a case that mocks `db.select` to return notification and preference rows and asserts `collectUserExportPayload`'s result (exported indirectly via `startPrivacyExport`, or directly if `collectUserExportPayload` is exported — check whether it already is; if not, keep this as a lower-priority verification and instead rely on the existing `tests/privacy-workflows.test.js` end-to-end coverage of `startPrivacyExport`, extending that file's assertions to include the new fields if it already asserts on export payload shape).

- [ ] **Step 12: Run the full privacy test suite to confirm no regression**

Run: `npx vitest run tests/privacy-retention.test.js tests/privacy-notifications.test.js tests/privacy-workflows.test.js tests/privacy-consent.test.js`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add lib/privacy.js lib/privacy-retention.js tests/privacy-notifications.test.js tests/privacy-retention.test.js
git commit -m "feat(notifications): plug notifications into privacy export, deletion, and retention pruning"
```

---

## Final Checklist (run once, after all 15 tasks)

- [ ] Run: `npm run test` — full suite passes.
- [ ] Run: `npm run lint` — no new lint errors.
- [ ] Run: `npm run build` — production build succeeds (this is the only way to compile-check the JSX changes in `HeaderNav.jsx`, `recipe-card.jsx`, `notifications-form.jsx`, and the two new page routes, since Vitest here runs in a Node environment without a DOM).
- [ ] Confirm `NOTIFICATIONS_UNSUBSCRIBE_SECRET` and (if not already set) `APP_BASE_URL` are documented for whoever configures the deploy environment — grep the repo for how other required env vars like `OCI_EMAIL_SENDER` are surfaced to the deployer (a `.env.example`, README, or Netlify UI note) and add the new var the same way, or flag it explicitly in the session handoff if no such place exists.
- [ ] Confirm the generated migration from Task 1 has **not** been applied to the linked Neon DB by this session (`npm run db:migrate` was never run) — applying it is a deliberate deploy step for the user.
