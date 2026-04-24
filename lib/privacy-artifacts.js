import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';

const PRIVACY_EXPORT_STORE = 'privacy-exports';
const LOCAL_PRIVACY_EXPORT_DIR = '/tmp/om-recipes-privacy-exports';

function hasNetlifyBlobsContext(env = process.env) {
    return Boolean(env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function resolveLocalPrivacyExportPath(key) {
    const baseDir = path.resolve(LOCAL_PRIVACY_EXPORT_DIR);
    const resolvedPath = path.resolve(baseDir, key);
    if (!resolvedPath.startsWith(baseDir)) {
        throw new Error('Invalid privacy artifact key');
    }
    return resolvedPath;
}

export function buildPrivacyArtifactKey({ userUuid, requestId, now = new Date() }) {
    const safeTimestamp = now.toISOString().replace(/[:.]/g, '-');
    return `${userUuid}/privacy-export-${requestId}-${safeTimestamp}.zip`;
}

export async function putPrivacyArtifact({ key, buffer, contentType = 'application/zip' }) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(PRIVACY_EXPORT_STORE);
        await store.set(key, buffer, {
            metadata: {
                contentType
            }
        });
        return;
    }

    const filePath = resolveLocalPrivacyExportPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
}

export async function getPrivacyArtifact({ key }) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(PRIVACY_EXPORT_STORE);
        const blob = await store.getWithMetadata(key, { type: 'arrayBuffer' });
        if (!blob) return null;
        return {
            buffer: Buffer.from(blob.data),
            metadata: blob.metadata ?? {}
        };
    }

    const filePath = resolveLocalPrivacyExportPath(key);
    try {
        const buffer = await fs.readFile(filePath);
        return {
            buffer,
            metadata: {}
        };
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export async function deletePrivacyArtifact({ key }) {
    if (hasNetlifyBlobsContext()) {
        const store = getStore(PRIVACY_EXPORT_STORE);
        await store.delete(key);
        return;
    }

    const filePath = resolveLocalPrivacyExportPath(key);
    await fs.rm(filePath, { force: true });
}
