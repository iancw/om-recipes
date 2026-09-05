import fs from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'user-state';
const LOCAL_DIR = '/tmp/om-recipes-user-state';

export function hasNetlifyBlobsContext(env = process.env) {
    return Boolean(env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function resolveLocalPath(key) {
    const baseDir = path.resolve(LOCAL_DIR);
    const resolvedPath = path.resolve(baseDir, key);
    if (resolvedPath !== baseDir && !resolvedPath.startsWith(baseDir + path.sep)) {
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
