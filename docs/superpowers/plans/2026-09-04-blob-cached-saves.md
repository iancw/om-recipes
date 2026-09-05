# Blob-Cached Saves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the save-button correctness bug (toggling blindly flips whatever Postgres actually has, since the button's displayed state is hardcoded and never reflects truth) and stop every save/unsave from writing to Postgres immediately — buffer it in Netlify Blobs and reconcile to Postgres on an hourly schedule (or sooner, piggybacked on a write the user already triggers).

**Architecture:** A durable per-user JSON blob (`state/users/<uuid>.json`, holding just `{ savedRecipeIds, userId, hydratedAt }` for this plan) becomes the source of truth for "is this recipe saved" on every read and every toggle — hydrated from Postgres once, lazily, per user. Toggling a save mutates the blob directly (no Postgres write) and marks the user "dirty" via a presence key (`pending/<uuid>`). An hourly Netlify scheduled function — plus inline piggyback calls from actions that already touch Postgres for that same user — reconciles each dirty user's blob (treated as *desired final state*) against the real `saved_recipes` table via a set-diff (insert what's missing, delete what's extra; no event log needed since the table is a plain membership pair).

**Tech Stack:** `@netlify/blobs` (already a project dependency, already used by `lib/privacy-artifacts.js` with an identical local-filesystem dev fallback this plan reuses the same pattern for), Netlify Scheduled Functions (`@netlify/functions`'s `schedule()`, same pattern as the existing `netlify/functions/notification-digest.js`), Drizzle ORM, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-blob-cached-user-state-design.md`, §§1–8 (the per-user Blobs cache). This plan implements the **saves** portion only — `savedRecipeIds` and the flush/piggyback machinery. **Notifications** (§§ the notification-list/preferences/read-receipt parts of §1–8, plus the notification bell's polling behavior) are explicitly out of scope here and belong to a separate, later plan that extends the same blob and the same flush job. Do not add a `notifications` or `preferences` field to the blob schema in this plan — that's the next plan's job.

**Depends on:** the already-shipped `2026-09-04-public-recipe-data-caching` plan (recipe index/detail caching) — this plan reuses its `getRecipeIndex()` to check recipe existence on the save-toggle path without a live query, and mirrors its established local-dev-vs-Netlify-runtime pattern.

## Global Constraints

- The per-user blob schema for this plan is exactly `{ savedRecipeIds: number[], userId: number, hydratedAt: number }` — no `notifications`, `preferences`, or other fields. A later plan extends this same JSON shape; don't preempt it.
- Blob keys: `state/users/<uuid>.json` for the per-user state, `pending/<uuid>` for the dirty-marker. Both live in one Netlify Blobs store named `user-state`.
- No Postgres write happens on the save-toggle request itself. The only Postgres write on that path is the existing, unchanged `notifyRecipeSaved` call (a small, already-existing insert) — kept synchronous exactly as it is today; only the `savedRecipes` row itself is deferred.
- Reconciliation treats the blob's `savedRecipeIds` as *desired end state* and diffs it against Postgres — insert missing rows, delete extra rows. Do not implement this as an event log or a replay of toggle actions.
- The scheduled flush runs `@hourly`, unconditional (no time-of-day gate, unlike the existing 6pm-gated digest function).
- Any action that already performs a synchronous Postgres write for a specific user (comment add, recipe upload, notification-preference change, login/magic-link consumption) also reconciles that same user's pending state inline, using the same single-user reconciliation function the scheduled job uses — not a duplicate implementation.
- Local development (`npm run dev`, i.e. plain `next dev`, not `netlify dev`) has no `NETLIFY_BLOBS_CONTEXT` — every Blobs-backed function in this plan must fall back to local-filesystem storage exactly the way `lib/privacy-artifacts.js` already does (`hasNetlifyBlobsContext()` check, `/tmp/...` directory fallback), so the feature is testable without `netlify dev`.
- Run `npm test` (vitest) after every task. Do not run the full `npm run lint` — it fails repo-wide with ~303 pre-existing errors unrelated to this or any other plan in this repo. Lint only the files a task touches, e.g. `npx eslint <files>`.

---

### Task 1: Low-level Blobs store wrapper (`lib/user-state-store.js`)

A generic, reusable get/set/delete/list-by-prefix JSON key-value wrapper around `@netlify/blobs`, with the same local-filesystem fallback `lib/privacy-artifacts.js` already uses for local dev. No save-specific logic lives here — this file knows nothing about users, saves, or notifications, just "JSON by key" and "keys under a prefix."

**Files:**
- Create: `lib/user-state-store.js`
- Test: `tests/user-state-store.test.js`

**Interfaces:**
- Consumes: `getStore` (`@netlify/blobs`), `node:fs/promises`, `node:path`.
- Produces (used by Tasks 3, 4):
  - `getUserStateJson(key: string): Promise<any | null>`
  - `setUserStateJson(key: string, data: any): Promise<void>`
  - `deleteUserStateKey(key: string): Promise<void>`
  - `listUserStateKeys(prefix: string): Promise<string[]>` — returns full keys (including the prefix), matching what `@netlify/blobs`'s `store.list({ prefix })` returns.

- [ ] **Step 1: Write the failing tests**

Create `tests/user-state-store.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

let getStoreMock;
let storeGet;
let storeSetJSON;
let storeDelete;
let storeList;

vi.mock('@netlify/blobs', () => ({
    getStore: (...args) => getStoreMock(...args)
}));

function makeFakeStore() {
    storeGet = vi.fn();
    storeSetJSON = vi.fn(() => Promise.resolve({ modified: true }));
    storeDelete = vi.fn(() => Promise.resolve());
    storeList = vi.fn(() => Promise.resolve({ blobs: [], directories: [] }));
    return { get: storeGet, setJSON: storeSetJSON, delete: storeDelete, list: storeList };
}

describe('user-state-store — Netlify Blobs context', () => {
    let originalEnv;

    beforeEach(() => {
        vi.resetModules();
        originalEnv = process.env.NETLIFY_BLOBS_CONTEXT;
        process.env.NETLIFY_BLOBS_CONTEXT = 'fake-context';
        getStoreMock = vi.fn(() => makeFakeStore());
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
        else process.env.NETLIFY_BLOBS_CONTEXT = originalEnv;
    });

    it('reads JSON with strong consistency', async () => {
        storeGet.mockResolvedValue({ savedRecipeIds: [1, 2] });
        const { getUserStateJson } = await import('../lib/user-state-store.js');

        const result = await getUserStateJson('state/users/abc.json');

        expect(result).toEqual({ savedRecipeIds: [1, 2] });
        expect(storeGet).toHaveBeenCalledWith('state/users/abc.json', { type: 'json', consistency: 'strong' });
    });

    it('returns null when the key does not exist', async () => {
        storeGet.mockResolvedValue(null);
        const { getUserStateJson } = await import('../lib/user-state-store.js');

        expect(await getUserStateJson('state/users/missing.json')).toBeNull();
    });

    it('writes JSON via setJSON', async () => {
        const { setUserStateJson } = await import('../lib/user-state-store.js');

        await setUserStateJson('state/users/abc.json', { savedRecipeIds: [3] });

        expect(storeSetJSON).toHaveBeenCalledWith('state/users/abc.json', { savedRecipeIds: [3] });
    });

    it('deletes a key', async () => {
        const { deleteUserStateKey } = await import('../lib/user-state-store.js');

        await deleteUserStateKey('pending/abc');

        expect(storeDelete).toHaveBeenCalledWith('pending/abc');
    });

    it('lists keys under a prefix', async () => {
        storeList.mockResolvedValue({ blobs: [{ key: 'pending/abc', etag: 'e1' }, { key: 'pending/def', etag: 'e2' }], directories: [] });
        const { listUserStateKeys } = await import('../lib/user-state-store.js');

        const keys = await listUserStateKeys('pending/');

        expect(keys).toEqual(['pending/abc', 'pending/def']);
        expect(storeList).toHaveBeenCalledWith({ prefix: 'pending/' });
    });
});

describe('user-state-store — local filesystem fallback (no Netlify context)', () => {
    let tmpDir;
    let originalEnv;

    beforeEach(async () => {
        vi.resetModules();
        originalEnv = process.env.NETLIFY_BLOBS_CONTEXT;
        delete process.env.NETLIFY_BLOBS_CONTEXT;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-state-store-test-'));
        vi.doMock('../lib/user-state-store.js', async () => {
            const actual = await vi.importActual('../lib/user-state-store.js');
            return actual;
        });
    });

    afterEach(async () => {
        if (originalEnv === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
        else process.env.NETLIFY_BLOBS_CONTEXT = originalEnv;
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('round-trips JSON through the filesystem when no Netlify context is present', async () => {
        const { getUserStateJson, setUserStateJson, deleteUserStateKey, listUserStateKeys } = await import('../lib/user-state-store.js');

        expect(await getUserStateJson('state/users/local-test.json')).toBeNull();

        await setUserStateJson('state/users/local-test.json', { savedRecipeIds: [7] });
        expect(await getUserStateJson('state/users/local-test.json')).toEqual({ savedRecipeIds: [7] });

        await setUserStateJson('pending/local-test', { since: 123 });
        const keys = await listUserStateKeys('pending/');
        expect(keys).toContain('pending/local-test');

        await deleteUserStateKey('state/users/local-test.json');
        expect(await getUserStateJson('state/users/local-test.json')).toBeNull();
    });

    it('returns an empty list for a prefix with no entries', async () => {
        const { listUserStateKeys } = await import('../lib/user-state-store.js');
        expect(await listUserStateKeys('pending/')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/user-state-store.test.js`
Expected: FAIL — `lib/user-state-store.js` doesn't exist yet.

- [ ] **Step 3: Create `lib/user-state-store.js`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'user-state';
const LOCAL_DIR = '/tmp/om-recipes-user-state';

function hasNetlifyBlobsContext(env = process.env) {
    return Boolean(env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function resolveLocalPath(key) {
    const baseDir = path.resolve(LOCAL_DIR);
    const resolvedPath = path.resolve(baseDir, key);
    if (!resolvedPath.startsWith(baseDir)) {
        throw new Error('Invalid user-state key');
    }
    return resolvedPath;
}

export async function getUserStateJson(key) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(STORE_NAME);
        const value = await store.get(key, { type: 'json', consistency: 'strong' });
        return value ?? null;
    }

    try {
        const raw = await fs.readFile(resolveLocalPath(key), 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export async function setUserStateJson(key, data) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(STORE_NAME);
        await store.setJSON(key, data);
        return;
    }

    const filePath = resolveLocalPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data));
}

export async function deleteUserStateKey(key) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(STORE_NAME);
        await store.delete(key);
        return;
    }

    await fs.rm(resolveLocalPath(key), { force: true });
}

export async function listUserStateKeys(prefix) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(STORE_NAME);
        const result = await store.list({ prefix });
        return result.blobs.map((blob) => blob.key);
    }

    const dir = resolveLocalPath(prefix);
    try {
        const entries = await fs.readdir(dir);
        return entries.map((entry) => `${prefix}${entry}`);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/user-state-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/user-state-store.js tests/user-state-store.test.js
git commit -m "$(cat <<'EOF'
Add a generic Blobs-backed key-value store with a local-dev fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Postgres-side helpers for hydration and reconciliation (`lib/recipe-saves.js`)

Two additions to the existing `lib/recipe-saves.js`: one to read a user's *entire* saved-recipe set (needed for cache hydration — the existing `getSavedRecipeIdsForUser` only checks membership against a caller-supplied candidate list, which can't answer "what has this user saved, full stop"), and one to reconcile a desired final set against Postgres. This task only *adds* to the file — it does not remove `toggleSavedRecipeForUser`/`recipeExists` yet, since `app/recipes/save/route.js` still depends on them until Task 6.

**Files:**
- Modify: `lib/recipe-saves.js`
- Test: `tests/recipe-saves.test.js` (extend the existing file — it currently only tests `toggleSavedRecipeForUser`)

**Interfaces:**
- Consumes: `db`, `and`, `eq`, `inArray` (already imported in the file), `savedRecipes` schema table.
- Produces (used by Tasks 3, 4):
  - `getAllSavedRecipeIdsForUser(userId: number): Promise<Set<number>>`
  - `reconcileSavedRecipesForUser({ userId: number, desiredRecipeIds: number[] }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Add to `tests/recipe-saves.test.js` (new `describe` blocks alongside the existing `toggleSavedRecipeForUser` one — keep the file's existing `vi.mock` calls and add nothing new to them, since these functions only touch `db`, already mocked):

```js
describe('getAllSavedRecipeIdsForUser', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        globalThis.__getAllSavedRecipeIdsForUser = mod.getAllSavedRecipeIdsForUser;
    });

    it('returns every recipe id the user has saved, unfiltered', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 5 }, { recipeId: 9 }]))
        }));

        const result = await globalThis.__getAllSavedRecipeIdsForUser(20);

        expect(result).toEqual(new Set([5, 9]));
    });

    it('returns an empty set for an invalid user id', async () => {
        const result = await globalThis.__getAllSavedRecipeIdsForUser(NaN);
        expect(result).toEqual(new Set());
    });
});

describe('reconcileSavedRecipesForUser', () => {
    let insertValuesMock;
    let deleteWhereMock;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        globalThis.__reconcileSavedRecipesForUser = mod.reconcileSavedRecipesForUser;
    });

    it('inserts missing rows and deletes extra rows to match the desired set', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 1 }, { recipeId: 2 }]))
        }));
        insertValuesMock = vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) }));
        insertMock = vi.fn(() => ({ values: insertValuesMock }));
        deleteWhereMock = vi.fn(() => Promise.resolve());
        deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

        await globalThis.__reconcileSavedRecipesForUser({ userId: 20, desiredRecipeIds: [2, 3] });

        expect(insertValuesMock).toHaveBeenCalledWith([{ userId: 20, recipeId: 3 }]);
        expect(deleteWhereMock).toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledWith(expect.anything());
    });

    it('does nothing when the desired set already matches Postgres', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 1 }]))
        }));
        insertMock = vi.fn();
        deleteMock = vi.fn();

        await globalThis.__reconcileSavedRecipesForUser({ userId: 20, desiredRecipeIds: [1] });

        expect(insertMock).not.toHaveBeenCalled();
        expect(deleteMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/recipe-saves.test.js`
Expected: FAIL — `getAllSavedRecipeIdsForUser`/`reconcileSavedRecipesForUser` are not exported yet.

- [ ] **Step 3: Add the two functions to `lib/recipe-saves.js`**

Add near the end of the file (after `toggleSavedRecipeForUser`, before the final closing of the file):

```js
export async function getAllSavedRecipeIdsForUser(userId) {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId)) return new Set();

    const rows = await db
        .select({ recipeId: savedRecipes.recipeId })
        .from(savedRecipes)
        .where(eq(savedRecipes.userId, normalizedUserId));

    return new Set(rows.map((row) => row.recipeId));
}

export async function reconcileSavedRecipesForUser({ userId, desiredRecipeIds }) {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId)) return;

    const desired = new Set(normalizeRecipeIds(desiredRecipeIds));
    const current = await getAllSavedRecipeIdsForUser(normalizedUserId);

    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    if (toAdd.length > 0) {
        await db
            .insert(savedRecipes)
            .values(toAdd.map((recipeId) => ({ userId: normalizedUserId, recipeId })))
            .onConflictDoNothing();
    }

    if (toRemove.length > 0) {
        await db
            .delete(savedRecipes)
            .where(and(eq(savedRecipes.userId, normalizedUserId), inArray(savedRecipes.recipeId, toRemove)));
    }
}
```

(`normalizeRecipeIds` is the existing private helper already defined at the top of this file — reuse it, don't redefine it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/recipe-saves.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/recipe-saves.js tests/recipe-saves.test.js
git commit -m "$(cat <<'EOF'
Add full-set read and desired-state reconciliation for saved recipes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Per-user saved-state cache (`lib/user-state-cache.js`)

The business-logic layer on top of Task 1's raw store: hydrate a user's saved-recipe set from Postgres on first read, mutate it on toggle, and track which users have unreconciled changes.

**Files:**
- Create: `lib/user-state-cache.js`
- Test: `tests/user-state-cache.test.js`

**Interfaces:**
- Consumes: `getUserStateJson`, `setUserStateJson`, `deleteUserStateKey`, `listUserStateKeys` (`lib/user-state-store.js`, Task 1), `getAllSavedRecipeIdsForUser` (`lib/recipe-saves.js`, Task 2).
- Produces (used by Tasks 4, 6, 7, 8, 9, 10):
  - `stateKey(uuid: string): string` — `` `state/users/${uuid}.json` ``
  - `pendingKey(uuid: string): string` — `` `pending/${uuid}` ``
  - `getUserSavedState(uuid: string, userId: number): Promise<{ savedRecipeIds: number[], userId: number, hydratedAt: number }>`
  - `toggleSavedRecipeInState(uuid: string, userId: number, recipeId: number): Promise<boolean>` — returns the new `isSaved` value
  - `markUserStateDirty(uuid: string): Promise<void>`
  - `clearUserStateDirty(uuid: string): Promise<void>`
  - `listDirtyUserUuids(): Promise<string[]>` — bare uuids, prefix stripped

- [ ] **Step 1: Write the failing tests**

Create `tests/user-state-cache.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let setUserStateJsonMock;
let deleteUserStateKeyMock;
let listUserStateKeysMock;
let getAllSavedRecipeIdsForUserMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args),
    setUserStateJson: (...args) => setUserStateJsonMock(...args),
    deleteUserStateKey: (...args) => deleteUserStateKeyMock(...args),
    listUserStateKeys: (...args) => listUserStateKeysMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    getAllSavedRecipeIdsForUser: (...args) => getAllSavedRecipeIdsForUserMock(...args)
}));

describe('stateKey / pendingKey', () => {
    it('build the expected key paths', async () => {
        const { stateKey, pendingKey } = await import('../lib/user-state-cache.js');
        expect(stateKey('abc-uuid')).toBe('state/users/abc-uuid.json');
        expect(pendingKey('abc-uuid')).toBe('pending/abc-uuid');
    });
});

describe('getUserSavedState', () => {
    beforeEach(() => {
        vi.resetModules();
        getUserStateJsonMock = vi.fn();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        getAllSavedRecipeIdsForUserMock = vi.fn(() => Promise.resolve(new Set([1, 2])));
    });

    it('returns the cached blob without hydrating when one already exists', async () => {
        getUserStateJsonMock.mockResolvedValue({ savedRecipeIds: [3], userId: 20, hydratedAt: 111 });
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(result).toEqual({ savedRecipeIds: [3], userId: 20, hydratedAt: 111 });
        expect(getAllSavedRecipeIdsForUserMock).not.toHaveBeenCalled();
        expect(setUserStateJsonMock).not.toHaveBeenCalled();
    });

    it('hydrates from Postgres and writes the blob when none exists yet', async () => {
        getUserStateJsonMock.mockResolvedValue(null);
        const { getUserSavedState } = await import('../lib/user-state-cache.js');

        const result = await getUserSavedState('abc-uuid', 20);

        expect(getAllSavedRecipeIdsForUserMock).toHaveBeenCalledWith(20);
        expect(result.savedRecipeIds.sort()).toEqual([1, 2]);
        expect(result.userId).toBe(20);
        expect(typeof result.hydratedAt).toBe('number');
        expect(setUserStateJsonMock).toHaveBeenCalledWith('state/users/abc-uuid.json', expect.objectContaining({ userId: 20 }));
    });
});

describe('toggleSavedRecipeInState', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        getAllSavedRecipeIdsForUserMock = vi.fn(() => Promise.resolve(new Set()));
    });

    it('adds the recipe and returns true when not currently saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(true);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds.sort()).toEqual([1, 5]);
    });

    it('removes the recipe and returns false when already saved', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [1, 5], userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        const isSaved = await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(isSaved).toBe(false);
        const [, writtenBlob] = setUserStateJsonMock.mock.calls.find(([key]) => key === 'state/users/abc-uuid.json');
        expect(writtenBlob.savedRecipeIds).toEqual([1]);
    });

    it('marks the user dirty as a side effect', async () => {
        getUserStateJsonMock = vi.fn().mockResolvedValue({ savedRecipeIds: [], userId: 20, hydratedAt: 1 });
        const { toggleSavedRecipeInState } = await import('../lib/user-state-cache.js');

        await toggleSavedRecipeInState('abc-uuid', 20, 5);

        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });
});

describe('dirty tracking', () => {
    beforeEach(() => {
        vi.resetModules();
        setUserStateJsonMock = vi.fn(() => Promise.resolve());
        deleteUserStateKeyMock = vi.fn(() => Promise.resolve());
        listUserStateKeysMock = vi.fn(() => Promise.resolve(['pending/abc-uuid', 'pending/def-uuid']));
    });

    it('markUserStateDirty writes a pending marker', async () => {
        const { markUserStateDirty } = await import('../lib/user-state-cache.js');
        await markUserStateDirty('abc-uuid');
        expect(setUserStateJsonMock).toHaveBeenCalledWith('pending/abc-uuid', expect.any(Object));
    });

    it('clearUserStateDirty deletes the pending marker', async () => {
        const { clearUserStateDirty } = await import('../lib/user-state-cache.js');
        await clearUserStateDirty('abc-uuid');
        expect(deleteUserStateKeyMock).toHaveBeenCalledWith('pending/abc-uuid');
    });

    it('listDirtyUserUuids strips the prefix', async () => {
        const { listDirtyUserUuids } = await import('../lib/user-state-cache.js');
        const uuids = await listDirtyUserUuids();
        expect(uuids).toEqual(['abc-uuid', 'def-uuid']);
        expect(listUserStateKeysMock).toHaveBeenCalledWith('pending/');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/user-state-cache.test.js`
Expected: FAIL — `lib/user-state-cache.js` doesn't exist yet.

- [ ] **Step 3: Create `lib/user-state-cache.js`**

```js
import { getUserStateJson, setUserStateJson, deleteUserStateKey, listUserStateKeys } from './user-state-store.js';
import { getAllSavedRecipeIdsForUser } from './recipe-saves.js';

const STATE_PREFIX = 'state/users/';
const PENDING_PREFIX = 'pending/';

export function stateKey(uuid) {
    return `${STATE_PREFIX}${uuid}.json`;
}

export function pendingKey(uuid) {
    return `${PENDING_PREFIX}${uuid}`;
}

export async function getUserSavedState(uuid, userId) {
    const existing = await getUserStateJson(stateKey(uuid));
    if (existing) return existing;

    const savedRecipeIds = [...(await getAllSavedRecipeIdsForUser(userId))];
    const hydrated = { savedRecipeIds, userId, hydratedAt: Date.now() };
    await setUserStateJson(stateKey(uuid), hydrated);
    return hydrated;
}

export async function toggleSavedRecipeInState(uuid, userId, recipeId) {
    const state = await getUserSavedState(uuid, userId);
    const set = new Set(state.savedRecipeIds);
    const isSaved = !set.has(recipeId);

    if (isSaved) {
        set.add(recipeId);
    } else {
        set.delete(recipeId);
    }

    const nextState = { ...state, savedRecipeIds: [...set] };
    await setUserStateJson(stateKey(uuid), nextState);
    await markUserStateDirty(uuid);
    return isSaved;
}

export async function markUserStateDirty(uuid) {
    await setUserStateJson(pendingKey(uuid), { since: Date.now() });
}

export async function clearUserStateDirty(uuid) {
    await deleteUserStateKey(pendingKey(uuid));
}

export async function listDirtyUserUuids() {
    const keys = await listUserStateKeys(PENDING_PREFIX);
    return keys.map((key) => key.slice(PENDING_PREFIX.length));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/user-state-cache.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/user-state-cache.js tests/user-state-cache.test.js
git commit -m "$(cat <<'EOF'
Add the per-user saved-state cache: lazy hydration, toggle, dirty tracking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Reconciliation logic (`lib/user-state-flush.js`)

The single-user reconciliation function both the scheduled job (Task 5) and every piggyback call site (Task 9) share — written once, used from both places, so there is exactly one implementation of "make Postgres match this user's blob."

**Files:**
- Create: `lib/user-state-flush.js`
- Test: `tests/user-state-flush.test.js`

**Interfaces:**
- Consumes: `getUserStateJson` (`lib/user-state-store.js`, Task 1), `stateKey`, `clearUserStateDirty`, `listDirtyUserUuids` (`lib/user-state-cache.js`, Task 3), `reconcileSavedRecipesForUser` (`lib/recipe-saves.js`, Task 2).
- Produces (used by Tasks 5, 9):
  - `reconcileUserState(uuid: string): Promise<void>` — safe to call for a user with no pending state (no-op).
  - `reconcileAllDirtyUserStates(): Promise<{ reconciled: number, failed: number }>`

- [ ] **Step 1: Write the failing tests**

Create `tests/user-state-flush.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let getUserStateJsonMock;
let clearUserStateDirtyMock;
let listDirtyUserUuidsMock;
let reconcileSavedRecipesForUserMock;

vi.mock('../lib/user-state-store.js', () => ({
    getUserStateJson: (...args) => getUserStateJsonMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    stateKey: (uuid) => `state/users/${uuid}.json`,
    clearUserStateDirty: (...args) => clearUserStateDirtyMock(...args),
    listDirtyUserUuids: (...args) => listDirtyUserUuidsMock(...args)
}));

vi.mock('../lib/recipe-saves.js', () => ({
    reconcileSavedRecipesForUser: (...args) => reconcileSavedRecipesForUserMock(...args)
}));

describe('reconcileUserState', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
    });

    it('reconciles the blob\'s saved ids into Postgres and clears the dirty marker', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.resolve({ savedRecipeIds: [1, 2], userId: 20, hydratedAt: 1 }));
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).toHaveBeenCalledWith({ userId: 20, desiredRecipeIds: [1, 2] });
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });

    it('clears the dirty marker without touching Postgres when the blob no longer exists', async () => {
        getUserStateJsonMock = vi.fn(() => Promise.resolve(null));
        const { reconcileUserState } = await import('../lib/user-state-flush.js');

        await reconcileUserState('abc-uuid');

        expect(reconcileSavedRecipesForUserMock).not.toHaveBeenCalled();
        expect(clearUserStateDirtyMock).toHaveBeenCalledWith('abc-uuid');
    });
});

describe('reconcileAllDirtyUserStates', () => {
    beforeEach(() => {
        vi.resetModules();
        clearUserStateDirtyMock = vi.fn(() => Promise.resolve());
        reconcileSavedRecipesForUserMock = vi.fn(() => Promise.resolve());
    });

    it('reconciles every dirty user and reports a summary', async () => {
        listDirtyUserUuidsMock = vi.fn(() => Promise.resolve(['abc-uuid', 'def-uuid']));
        getUserStateJsonMock = vi.fn(() => Promise.resolve({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 }));
        const { reconcileAllDirtyUserStates } = await import('../lib/user-state-flush.js');

        const summary = await reconcileAllDirtyUserStates();

        expect(summary).toEqual({ reconciled: 2, failed: 0 });
    });

    it('isolates one user\'s failure from the rest of the batch', async () => {
        listDirtyUserUuidsMock = vi.fn(() => Promise.resolve(['abc-uuid', 'def-uuid']));
        let call = 0;
        getUserStateJsonMock = vi.fn(() => {
            call += 1;
            if (call === 1) return Promise.reject(new Error('boom'));
            return Promise.resolve({ savedRecipeIds: [1], userId: 20, hydratedAt: 1 });
        });
        const { reconcileAllDirtyUserStates } = await import('../lib/user-state-flush.js');

        const summary = await reconcileAllDirtyUserStates();

        expect(summary).toEqual({ reconciled: 1, failed: 1 });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/user-state-flush.test.js`
Expected: FAIL — `lib/user-state-flush.js` doesn't exist yet.

- [ ] **Step 3: Create `lib/user-state-flush.js`**

```js
import { getUserStateJson } from './user-state-store.js';
import { stateKey, clearUserStateDirty, listDirtyUserUuids } from './user-state-cache.js';
import { reconcileSavedRecipesForUser } from './recipe-saves.js';

export async function reconcileUserState(uuid) {
    const state = await getUserStateJson(stateKey(uuid));
    if (state) {
        await reconcileSavedRecipesForUser({ userId: state.userId, desiredRecipeIds: state.savedRecipeIds });
    }
    await clearUserStateDirty(uuid);
}

export async function reconcileAllDirtyUserStates() {
    const uuids = await listDirtyUserUuids();
    let reconciled = 0;
    let failed = 0;

    for (const uuid of uuids) {
        try {
            await reconcileUserState(uuid);
            reconciled += 1;
        } catch (error) {
            failed += 1;
            console.error('[user-state-flush] reconcile failed', { uuid, error });
        }
    }

    return { reconciled, failed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/user-state-flush.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/user-state-flush.js tests/user-state-flush.test.js
git commit -m "$(cat <<'EOF'
Add single-user and batch reconciliation for the saved-state cache

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Hourly scheduled flush function

**Files:**
- Create: `netlify/functions/state-cache-flush.js`
- Modify: `netlify.toml`
- Test: `tests/state-cache-flush.test.js`

**Interfaces:**
- Consumes: `reconcileAllDirtyUserStates` (`lib/user-state-flush.js`, Task 4), `schedule` (`@netlify/functions`).

- [ ] **Step 1: Write the failing test**

Create `tests/state-cache-flush.test.js` (mirroring `tests/notification-digest.test.js`'s pattern if one exists — check first with `ls tests/ | grep notification-digest`; if it exists, read it and follow the same `vi.mock('@netlify/functions', ...)` shape):

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

let reconcileAllDirtyUserStatesMock;
let scheduledHandler;

vi.mock('@netlify/functions', () => ({
    schedule: (cron, handler) => {
        scheduledHandler = handler;
        return handler;
    }
}));

vi.mock('../../lib/user-state-flush.js', () => ({
    reconcileAllDirtyUserStates: (...args) => reconcileAllDirtyUserStatesMock(...args)
}));

describe('state-cache-flush scheduled function', () => {
    beforeEach(async () => {
        vi.resetModules();
        reconcileAllDirtyUserStatesMock = vi.fn(() => Promise.resolve({ reconciled: 3, failed: 0 }));
        await import('../../netlify/functions/state-cache-flush.js');
    });

    it('reconciles all dirty users and returns a 200 with the summary', async () => {
        const response = await scheduledHandler();

        expect(reconcileAllDirtyUserStatesMock).toHaveBeenCalled();
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ reconciled: 3, failed: 0 });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/state-cache-flush.test.js`
Expected: FAIL — `netlify/functions/state-cache-flush.js` doesn't exist yet.

- [ ] **Step 3: Create `netlify/functions/state-cache-flush.js`**

```js
import { schedule } from '@netlify/functions';
import { reconcileAllDirtyUserStates } from '../../lib/user-state-flush.js';

export const handler = schedule('@hourly', async () => {
    const summary = await reconcileAllDirtyUserStates();
    console.log('[state-cache-flush]', summary);

    return { statusCode: 200, body: JSON.stringify(summary) };
});
```

- [ ] **Step 4: Add the esbuild bundler entry to `netlify.toml`**

The existing file has one function-specific entry (`[functions."notification-digest"]`) for exactly the reason documented in its comment above it (the default bundler can't handle the transitive `../../lib/...`/`db/index.ts` import graph). Add an identical entry for the new function, right after the existing one:

```toml
[functions."notification-digest"]
  node_bundler = "esbuild"

[functions."state-cache-flush"]
  node_bundler = "esbuild"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/state-cache-flush.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/state-cache-flush.js netlify.toml tests/state-cache-flush.test.js
git commit -m "$(cat <<'EOF'
Add the hourly scheduled function that flushes buffered saves to Postgres

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rewire the save-toggle route onto the cache, remove dead code

The route stops writing to Postgres on toggle and stops doing a live existence check — both replaced by cache reads. `toggleSavedRecipeForUser` and `recipeExists` become unused by this change (confirmed: their only callers anywhere in the repo are this route and their own tests) — remove them in the same commit rather than leaving dead code behind.

**Files:**
- Modify: `app/recipes/save/route.js`
- Modify: `lib/recipe-saves.js` (remove `toggleSavedRecipeForUser`, `recipeExists`)
- Modify: `tests/recipe-save-route.test.js` (full rewrite)
- Modify: `tests/recipe-saves.test.js` (remove the `describe('toggleSavedRecipeForUser', ...)` block Task 2 didn't touch)

**Interfaces:**
- Consumes: `getSession` (`lib/auth.js`), `getRecipeIndex` (`lib/public-recipe-catalog.js`, from the already-shipped recipe-caching plan), `toggleSavedRecipeInState` (`lib/user-state-cache.js`, Task 3), `notifyRecipeSaved` (`lib/notifications.js`, unchanged).

- [ ] **Step 1: Rewrite the failing test**

Replace `tests/recipe-save-route.test.js` in full:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

let getSessionMock;
let getRecipeIndexMock;
let toggleSavedRecipeInStateMock;
let notifyRecipeSavedMock;

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    getRecipeIndex: (...args) => getRecipeIndexMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    toggleSavedRecipeInState: (...args) => toggleSavedRecipeInStateMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: (...args) => notifyRecipeSavedMock(...args)
}));

describe('recipe save route', () => {
    beforeEach(() => {
        vi.resetModules();
        getSessionMock = vi.fn(() => Promise.resolve(null));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 123 }]));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(true));
        notifyRecipeSavedMock = vi.fn(() => Promise.resolve());
    });

    it('returns a login URL when the viewer is not authenticated', async () => {
        getSessionMock = vi.fn(() => Promise.resolve(null));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123, redirectTo: '/recipes/abc?id=123' }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
            error: 'Authentication required',
            loginUrl: '/login?redirectTo=%2Frecipes%2Fabc%3Fid%3D123'
        });
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });

    it('toggles the saved state via the cache for an authenticated user and notifies on save', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(true));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(toggleSavedRecipeInStateMock).toHaveBeenCalledWith('user-uuid', 42, 123);
        expect(notifyRecipeSavedMock).toHaveBeenCalledWith(123, 42);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ isSaved: true });
    });

    it('does not notify when the toggle results in unsaving', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(false));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(notifyRecipeSavedMock).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({ isSaved: false });
    });

    it('rejects a recipe id that is not in the cached index, with no DB call', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 999 }]));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(404);
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric recipe id', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 'nope' }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(400);
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-save-route.test.js`
Expected: FAIL — the route still imports `recipeExists`/`toggleSavedRecipeForUser`.

- [ ] **Step 3: Rewrite `app/recipes/save/route.js`**

```js
import { getSession } from '../../../lib/auth.js';
import { getRecipeIndex } from '../../../lib/public-recipe-catalog.js';
import { toggleSavedRecipeInState } from '../../../lib/user-state-cache.js';
import { notifyRecipeSaved } from '../../../lib/notifications.js';

export async function POST(request) {
    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const uuid = session?.user?.uuid ?? null;

    if (userId == null || uuid == null) {
        const body = await request.json().catch(() => ({}));
        const redirectTo = typeof body?.redirectTo === 'string' && body.redirectTo.trim() ? body.redirectTo.trim() : '/';
        return Response.json(
            {
                error: 'Authentication required',
                loginUrl: `/login?redirectTo=${encodeURIComponent(redirectTo)}`
            },
            { status: 401 }
        );
    }

    const body = await request.json().catch(() => ({}));
    const recipeId = Number(body?.recipeId);
    if (!Number.isFinite(recipeId)) {
        return Response.json({ error: 'Invalid recipe id' }, { status: 400 });
    }

    const index = await getRecipeIndex();
    if (!index.some((entry) => entry.id === recipeId)) {
        return Response.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const isSaved = await toggleSavedRecipeInState(uuid, userId, recipeId);
    if (isSaved) {
        await notifyRecipeSaved(recipeId, userId);
    }

    return Response.json({ isSaved });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-save-route.test.js`
Expected: PASS

- [ ] **Step 5: Remove the now-dead functions from `lib/recipe-saves.js`**

Delete `toggleSavedRecipeForUser` (the whole function) and `recipeExists` (the whole function) from `lib/recipe-saves.js`. Check the file's imports afterward — if `notifyRecipeSaved` (imported from `./notifications.js`) is no longer used by anything else in the file, remove that import too (it's currently only used inside `toggleSavedRecipeForUser`).

Then remove the corresponding `describe('toggleSavedRecipeForUser', ...)` block from `tests/recipe-saves.test.js` (added before this plan; Task 2 did not touch it) — including its now-unused `vi.mock('../lib/notifications.js', ...)` at the top of the file, if nothing else in the file still needs it (Task 2's new tests don't reference notifications at all).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — this also confirms nothing else in the repo still imports the removed functions (a stale import would fail to resolve).

- [ ] **Step 7: Commit**

```bash
git add app/recipes/save/route.js lib/recipe-saves.js tests/recipe-save-route.test.js tests/recipe-saves.test.js
git commit -m "$(cat <<'EOF'
Toggle saves through the blob cache instead of writing Postgres directly

The save button previously asked Postgres for the real state on every
toggle and flipped whatever it found — with no notion of the client's
prior state, clicking "save" on an already-saved recipe would unsave
it. It now flips membership in the user's cached saved-recipe set and
returns that; the underlying savedRecipes row is written later by the
hourly/piggyback flush (lib/user-state-flush.js).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Fix `isSaved` on the recipe detail page

The detail page currently hardcodes `isSaved: false` (from the earlier recipe-caching plan, which deliberately left this for this plan to fix). Read it from the cache instead.

**Files:**
- Modify: `app/recipes/[id]/page.jsx`
- Test: `tests/recipe-detail-page.test.js`

**Interfaces:**
- Consumes: `getUserSavedState` (`lib/user-state-cache.js`, Task 3).

- [ ] **Step 1: Update the failing test**

`tests/recipe-detail-page.test.js` currently mocks `resolveRecipeIndexEntry`/`findRelatedWhiteBalanceRecipes`/`getCachedRecipeDetail` and asserts `capturedRecipeCardProps.recipe.isSaved` is always `false`. Add a mock for the new dependency and a new test:

```js
// add alongside the existing vi.mock calls:
let getUserSavedStateMock;
vi.mock('../lib/user-state-cache.js', () => ({
    getUserSavedState: (...args) => getUserSavedStateMock(...args)
}));
```

In the file's `beforeEach`, add:
```js
getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [], userId: 42, hydratedAt: 1 }));
```

Change the existing assertion `expect(capturedRecipeCardProps.recipe.isSaved).toBe(false);` in the `'hydrates recipe media with asset-host URLs for the page loader'` test to instead reflect that this is now the "not saved" case, and add a new test proving the "saved" case works:

```js
it('reflects true isSaved when the viewer has this recipe in their cached saved set', async () => {
    getSessionMock = vi.fn(async () => ({ user: { id: 42, uuid: 'user-uuid' } }));
    getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [123], userId: 42, hydratedAt: 1 }));

    const mod = await import('../app/recipes/[id]/page.jsx');
    await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

    expect(getUserSavedStateMock).toHaveBeenCalledWith('user-uuid', 42);
    expect(capturedRecipeCardProps.recipe.isSaved).toBe(true);
});

it('stays false and skips the cache lookup for a logged-out viewer', async () => {
    getSessionMock = vi.fn(async () => null);

    const mod = await import('../app/recipes/[id]/page.jsx');
    await mod.default({ params: Promise.resolve({ id: 'portra-400' }) });

    expect(getUserSavedStateMock).not.toHaveBeenCalled();
    expect(capturedRecipeCardProps.recipe.isSaved).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-detail-page.test.js`
Expected: FAIL — `isSaved` is still hardcoded `false` regardless of the mocked cache.

- [ ] **Step 3: Update `app/recipes/[id]/page.jsx`**

Add the import:
```js
import { getUserSavedState } from '../../../lib/user-state-cache.js';
```

In `Page()`, right after `if (!recipe) return notFound();` and before the redirect check (so a redirecting request doesn't bother with this), add the saved-state lookup — the natural place is right after `userId`/`session` are known and `recipe.id` is available, so put it just after the redirect check instead (redirects `throw`, so code after that point only runs for the canonical URL):

```js
    if (recipe.slug && id && id !== recipe.slug) {
        permanentRedirect(getRecipePath(recipe));
    }
    if (session?.user?.uuid) {
        const savedState = await getUserSavedState(session.user.uuid, userId);
        recipe.isSaved = savedState.savedRecipeIds.includes(recipe.id);
    }
    const whiteBalance = getEquivalentWhiteBalance(recipe);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-detail-page.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/recipes/\[id\]/page.jsx tests/recipe-detail-page.test.js
git commit -m "$(cat <<'EOF'
Serve the recipe detail page's isSaved from the per-user cache

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Fix `isSaved`/`onlySaved` on the search route

Same fix for the homepage/search grid, plus switching `onlySaved` off its current live `getSavedRecipeIdsForUser` DB call onto the cache.

**Files:**
- Modify: `app/recipes/search/route.js`
- Test: `tests/recipe-search-route.test.js`

**Interfaces:**
- Consumes: `getUserSavedState` (`lib/user-state-cache.js`, Task 3).

- [ ] **Step 1: Update the failing test**

In `tests/recipe-search-route.test.js`, replace the `getSavedRecipeIdsForUser` mock with one for the new dependency:

```js
// change:
vi.mock('../lib/recipe-saves.js', () => ({
    getSavedRecipeIdsForUser: (...args) => getSavedRecipeIdsForUserMock(...args)
}));
// to:
vi.mock('../lib/user-state-cache.js', () => ({
    getUserSavedState: (...args) => getUserSavedStateMock(...args)
}));
```

Rename the `let getSavedRecipeIdsForUserMock;` declaration to `let getUserSavedStateMock;`, and in `beforeEach` change its default to `getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [], userId: 42, hydratedAt: 1 }));`.

The route's cache lookup is guarded by `session?.user?.uuid` being truthy (see Step 3) — the file's default session fixture, `getSessionMock = vi.fn(async () => ({ user: { id: 42 } }))`, has no `uuid`, which would silently skip the cache lookup in every test that doesn't override it. Fix the default fixture itself in `beforeEach`: `getSessionMock = vi.fn(async () => ({ user: { id: 42, uuid: 'user-uuid' } }));`.

Update the three tests that reference the old mock:

```js
it('returns hydrated comparison and sample images with no eager saved-status lookup for a logged-out request', async () => {
    getSessionMock = vi.fn(async () => null);
    const { GET } = await import('../app/recipes/search/route.js');
    const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0'));
    const body = await response.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].isSaved).toBe(false);
    expect(getUserSavedStateMock).not.toHaveBeenCalled();
});

it('marks isSaved true for cards the logged-in viewer has saved, false otherwise', async () => {
    getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [101], userId: 42, hydratedAt: 1 }));
    const { GET } = await import('../app/recipes/search/route.js');
    const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0'));
    const body = await response.json();

    expect(getUserSavedStateMock).toHaveBeenCalledWith('user-uuid', 42);
    expect(body.results[0].id).toBe(101);
    expect(body.results[0].isSaved).toBe(true);
});

it('filters to the saved set via the cache under onlySaved, with no DB call', async () => {
    getUserSavedStateMock = vi.fn(async () => ({ savedRecipeIds: [101], userId: 42, hydratedAt: 1 }));
    const { GET } = await import('../app/recipes/search/route.js');
    const response = await GET(new Request('https://om-recipes.test/recipes/search?q=&limit=12&offset=0&onlySaved=1'));
    const body = await response.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].isSaved).toBe(true);
    expect(getUserSavedStateMock).toHaveBeenCalledWith('user-uuid', 42);
});
```

Delete the now-obsolete `it('marks every result saved under the "saved" filter, without a separate saved-status query', ...)` test if it duplicates the new one above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recipe-search-route.test.js`
Expected: FAIL — the route still imports `getSavedRecipeIdsForUser`.

- [ ] **Step 3: Update `app/recipes/search/route.js`**

Change the import:
```js
// from:
import { getSavedRecipeIdsForUser } from '../../../lib/recipe-saves.js';
// to:
import { getUserSavedState } from '../../../lib/user-state-cache.js';
```

Replace the `savedRecipeIds`/`onlySaved` handling and the final response mapping:

```js
    if (onlyMine) {
        filtered = filtered.filter((recipe) => recipe.authorUserId === userId);
    }

    let savedRecipeIdSet = null;
    if (userId != null && session?.user?.uuid) {
        const savedState = await getUserSavedState(session.user.uuid, userId);
        savedRecipeIdSet = new Set(savedState.savedRecipeIds);
    }
    if (onlySaved) {
        filtered = filtered.filter((recipe) => savedRecipeIdSet?.has(recipe.id));
    }

    const sorted = sortRecipes(filtered, input.sortBy);
    const page = sorted.slice(input.offset, input.offset + input.limit);
    const hasMore = input.offset + input.limit < sorted.length;

    return Response.json({
        results: page.map(({ authorUserId, aliases, saveCount, authorId, createdAtMs, ...card }) => ({
            ...card,
            viewerIsLoggedIn: userId != null,
            isSaved: savedRecipeIdSet?.has(card.id) ?? false
        })),
        hasMore,
        nextOffset: input.offset + page.length
    });
```

(Keep everything above `if (onlyMine) { ... }` — the `input`/`onlyMine`/`onlySaved`/`session`/`userId`/`index`/`filtered` setup and the early `if ((onlyMine || onlySaved) && userId == null) { ... }` guard — exactly as it is today; only the block shown above changes.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recipe-search-route.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/recipes/search/route.js tests/recipe-search-route.test.js
git commit -m "$(cat <<'EOF'
Serve isSaved and onlySaved from the per-user cache on the search route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Piggyback reconciliation at existing write sites

Any action that already forces a synchronous Postgres write for a specific user also reconciles that user's own pending saves inline, so active users stay fully synced without waiting for the hourly sweep.

**Files:**
- Modify: `app/recipes/[id]/actions.js` (`addCommentAction`)
- Modify: `app/upload/actions.js` (recipe-prepare step, and all three sites inside `finalizeRecipeUploadAction`)
- Modify: `app/profile/actions.js` (`updateMyNotificationPreferencesAction`)
- Modify: `lib/auth.js` (`consumeMagicLink`)
- Test: `tests/recipe-comment-actions.test.js`, `tests/finalize-notify-sample-image.test.js`, `tests/notification-preferences-action.test.js`, `tests/auth-session.test.js` (or wherever `consumeMagicLink` is currently tested — check with `grep -rl "consumeMagicLink" tests/`)

**Interfaces:**
- Consumes: `reconcileUserState` (`lib/user-state-flush.js`, Task 4).

- [ ] **Step 1: `app/recipes/[id]/actions.js` — `addCommentAction`**

Add the import: `import { reconcileUserState } from '../../../lib/user-state-flush.js';`

The commenter's own uuid isn't currently loaded in this function — `session` (from `requireUser()`) already carries `session.user.uuid` (per `getSession()`'s payload shape in `lib/auth.js`). Change:

```js
    await notifyRecipeCommented(parsedRecipeId, comment.id, author.id);

    await revalidateRecipeDetail(parsedRecipeId);
    revalidatePath(getRecipePath(recipe));
```
to:
```js
    await notifyRecipeCommented(parsedRecipeId, comment.id, author.id);

    await revalidateRecipeDetail(parsedRecipeId);
    revalidatePath(getRecipePath(recipe));
    await reconcileUserState(session.user.uuid);
```

Update `tests/recipe-comment-actions.test.js`: add a `revalidateRecipeDetail`-style mock for `reconcileUserState` (`vi.mock('../lib/user-state-flush.js', () => ({ reconcileUserState: (...args) => reconcileUserStateMock(...args) }))`, `let reconcileUserStateMock;`, initialized `vi.fn(() => Promise.resolve())` in the relevant `beforeEach`), and assert `expect(reconcileUserStateMock).toHaveBeenCalledWith(9)` — check the file's session fixture first (`requireUser: () => Promise.resolve({ user: { id: 9 } })`, per the existing mock) and add `uuid: 'commenter-uuid'` to that fixture so the call has something concrete to assert against: `expect(reconcileUserStateMock).toHaveBeenCalledWith('commenter-uuid')`.

- [ ] **Step 2: `app/upload/actions.js` — recipe-prepare step and `finalizeRecipeUploadAction`**

Add the import: `import { reconcileUserState } from '../../lib/user-state-flush.js';`

At the recipe-prepare call site (the one guarded by `if (shouldCreateRecipe) { await revalidatePublicRecipeCatalog(); await revalidateRecipeDetail(createdRecipeId); }`), add a piggyback call using the uploader's own session (already available in this function as `session`, from `requireUser()`):

```js
        if (shouldCreateRecipe) {
            await revalidatePublicRecipeCatalog();
            await revalidateRecipeDetail(createdRecipeId);
        }
        await reconcileUserState(session.user.uuid);
```

(Note this one is unconditional — even when `shouldCreateRecipe` is false, the upload action itself is still a synchronous Postgres write for this user, so it's still a valid piggyback point.)

At each of the three sites inside `finalizeRecipeUploadAction` that call `revalidateRecipeDetail(preparedRecipeId)`, add `await reconcileUserState(session.user.uuid);` immediately after (same `session` variable already in scope from that function's own `requireUser()` call).

Update `tests/finalize-notify-sample-image.test.js`: add a mock for `lib/user-state-flush.js` the same way as `lib/public-recipe-catalog-cache.js`'s mock is set up in that file, and assert `expect(reconcileUserStateMock).toHaveBeenCalledWith('owner-uuid')` (or whatever uuid the fixture's `requireUser` mock returns — check `{ user: { id: 9, email: 'owner@example.com' } }` and add a `uuid` field to it).

- [ ] **Step 3: `app/profile/actions.js` — `updateMyNotificationPreferencesAction`**

Add the import: `import { reconcileUserState } from '../../lib/user-state-flush.js';`

Change:
```js
export async function updateMyNotificationPreferencesAction(formData) {
    const session = await requireUser();

    await upsertNotificationPreferences(session.user.id, {
        ...
    });

    revalidatePath('/profile');
}
```
to:
```js
export async function updateMyNotificationPreferencesAction(formData) {
    const session = await requireUser();

    await upsertNotificationPreferences(session.user.id, {
        ...
    });

    revalidatePath('/profile');
    await reconcileUserState(session.user.uuid);
}
```

Update `tests/notification-preferences-action.test.js`: mock `lib/user-state-flush.js`, add `uuid: 'owner-uuid'` to the `requireUser` fixture, and assert `expect(reconcileUserStateMock).toHaveBeenCalledWith('owner-uuid')`.

- [ ] **Step 4: `lib/auth.js` — `consumeMagicLink`**

Add the import: `import { reconcileUserState } from './user-state-flush.js';`

At the end of `consumeMagicLink`, right before its `return`:

```js
    return {
        redirectTo: normalizeRedirectPath(link.redirectTo, '/profile')
    };
```
becomes:
```js
    await reconcileUserState(updatedUser.uuid);

    return {
        redirectTo: normalizeRedirectPath(link.redirectTo, '/profile')
    };
```

`consumeMagicLink` is exercised in `tests/auth-session.test.js` (its `describe('consumeMagicLink', ...)` block, around line 237) — `tests/auth-routes.test.js` also references `consumeMagicLink` but only as a fully-mocked stand-in for testing the route wrapper, not the real implementation, so it needs no change.

In `tests/auth-session.test.js`, add a mock near the file's other `vi.mock` calls:
```js
let reconcileUserStateMock;
vi.mock('../lib/user-state-flush.js', () => ({
    reconcileUserState: (...args) => reconcileUserStateMock(...args)
}));
```
Initialize `reconcileUserStateMock = vi.fn(() => Promise.resolve());` in the outer `beforeEach` (same place `selectMock`/`updateMock`/etc. are initialized). Then in the `'creates a session and sets a validly signed cookie carrying the new session identity'` test, add after the existing assertions:
```js
            expect(reconcileUserStateMock).toHaveBeenCalledWith('user-uuid-abc');
```
(matching the test's existing `updateResponses = [[{ id: 1 }], [{ id: 7, uuid: 'user-uuid-abc' }]];` fixture, whose second entry is the updated `users` row `consumeMagicLink` uses as `updatedUser`).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/recipes/\[id\]/actions.js app/upload/actions.js app/profile/actions.js lib/auth.js tests/
git commit -m "$(cat <<'EOF'
Piggyback pending-save reconciliation on writes that already wake the DB

Comments, uploads, preference changes, and logins already perform a
synchronous Postgres write for the acting user — each now also
reconciles that same user's buffered saves inline, so active users
stay fully synced without waiting for the hourly flush.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Clean up the user-state blob on account deletion

Deleting an account should erase the saved-recipe state living in Blobs storage too, not just the Postgres rows.

**Files:**
- Modify: `lib/privacy.js`
- Test: `tests/privacy-workflows.test.js`

**Interfaces:**
- Consumes: `deleteUserStateKey` (`lib/user-state-store.js`, Task 1), `stateKey`, `pendingKey` (`lib/user-state-cache.js`, Task 3).

- [ ] **Step 1: Update the failing test**

In `tests/privacy-workflows.test.js`, add a mock for the two modules involved: `lib/user-state-store.js` (mock `deleteUserStateKey`) and `lib/user-state-cache.js` (real `stateKey`/`pendingKey` — these are pure string builders, safe to leave unmocked via `vi.importActual`, or just mock them too with the same literal template strings for simplicity: `stateKey: (uuid) => \`state/users/${uuid}.json\`, pendingKey: (uuid) => \`pending/${uuid}\``).

Add, after the existing `expect(deleteMock).toHaveBeenCalledTimes(7);` assertion in the account-deletion test:

```js
        expect(deleteUserStateKeyMock).toHaveBeenCalledWith('state/users/user-uuid.json');
        expect(deleteUserStateKeyMock).toHaveBeenCalledWith('pending/user-uuid');
```

(The test's `startAccountDeletion({ userId: 5, userUuid: 'user-uuid' })` call already supplies the uuid this needs.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/privacy-workflows.test.js`
Expected: FAIL

- [ ] **Step 3: Update `lib/privacy.js`**

Add the imports:
```js
import { deleteUserStateKey } from './user-state-store.js';
import { stateKey, pendingKey } from './user-state-cache.js';
```

Change `eraseAccountData`'s signature and its one call site:
```js
// from:
async function eraseAccountData(userId) {
// to:
async function eraseAccountData(userId, userUuid) {
```
```js
// from:
        await eraseAccountData(userId);
// to:
        await eraseAccountData(userId, userUuid);
```
(the call site is inside `startAccountDeletion`, which already receives `userUuid` as a parameter).

Inside `eraseAccountData`, add the cleanup at the very end of the function (after its existing body, right before the closing `}`):

```js
    await deleteUserStateKey(stateKey(userUuid));
    await deleteUserStateKey(pendingKey(userUuid));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/privacy-workflows.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/privacy.js tests/privacy-workflows.test.js
git commit -m "$(cat <<'EOF'
Delete the user-state blob and any pending marker on account deletion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Manual verification

Not a code task — confirms the whole chain works end to end.

- [ ] **Step 1: Start the app locally**

Run: `npm run dev`. Since this is plain `next dev` (not `netlify dev`), the Blobs store runs in its local-filesystem fallback mode (`/tmp/om-recipes-user-state`) — this is expected and exercises the same code paths.

- [ ] **Step 2: Confirm the save-button correctness fix**

Log in, save a recipe, reload the page — the button must show saved. Navigate away and back — still saved. Unsave it — reload — correctly shows unsaved. This is the original bug: confirm it's actually fixed, not just that the toggle "does something."

- [ ] **Step 3: Confirm no Postgres write on toggle**

Watch `db/index.ts`'s query logger output in the terminal running `npm run dev` while toggling a save. No `insert into "saved_recipes"` or `delete from "saved_recipes"` query should appear at toggle time (a `notifyRecipeSaved`-related query on the recipient side is expected and fine — that path is unchanged and intentionally still synchronous).

- [ ] **Step 4: Confirm hydration happens once**

Toggle a save for a "fresh" user (or delete `/tmp/om-recipes-user-state` to simulate one), then load a few recipe pages as that user. The very first request should show the hydration query in the log; subsequent requests for other recipes should not re-trigger it (check `/tmp/om-recipes-user-state/state/users/<uuid>.json` exists after the first request).

- [ ] **Step 5: Confirm reconciliation**

Manually invoke the reconciliation logic without waiting an hour — e.g. via a scratch Node script or a temporary route that calls `reconcileAllDirtyUserStates()` — after toggling a save, and confirm the `saved_recipes` table in Postgres actually gets the row, and `/tmp/om-recipes-user-state/pending/<uuid>` is removed afterward.

- [ ] **Step 6: Record results**

No code change — note in the PR/commit description (when this branch is proposed for merge) that manual verification was performed.
