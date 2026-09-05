import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        const fakeStore = makeFakeStore();
        getStoreMock = vi.fn(() => fakeStore);
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
    let originalEnv;

    beforeEach(() => {
        vi.resetModules();
        originalEnv = process.env.NETLIFY_BLOBS_CONTEXT;
        delete process.env.NETLIFY_BLOBS_CONTEXT;
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
        else process.env.NETLIFY_BLOBS_CONTEXT = originalEnv;
    });

    it('round-trips JSON through the filesystem when no Netlify context is present', async () => {
        const { getUserStateJson, setUserStateJson, deleteUserStateKey, listUserStateKeys } = await import('../lib/user-state-store.js');

        try {
            expect(await getUserStateJson('state/users/local-test.json')).toBeNull();

            await setUserStateJson('state/users/local-test.json', { savedRecipeIds: [7] });
            expect(await getUserStateJson('state/users/local-test.json')).toEqual({ savedRecipeIds: [7] });

            await setUserStateJson('pending/local-test', { since: 123 });
            const keys = await listUserStateKeys('pending/');
            expect(keys).toContain('pending/local-test');
        } finally {
            await deleteUserStateKey('state/users/local-test.json');
            await deleteUserStateKey('pending/local-test');
        }
    });

    it('returns an empty list for a prefix with no entries', async () => {
        const { listUserStateKeys } = await import('../lib/user-state-store.js');
        expect(await listUserStateKeys('nonexistent-prefix/')).toEqual([]);
    });
});
