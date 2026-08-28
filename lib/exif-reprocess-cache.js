import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DIR_NAME = '.exif-reprocess';

export function cachePaths(baseDir) {
    const root = resolve(baseDir, DIR_NAME);
    return {
        root,
        rawDir: join(root, 'raw'),
        progressFile: join(root, 'progress.jsonl'),
        reportFile: join(root, 'report.json')
    };
}

export async function ensureCacheDirs(paths) {
    await mkdir(paths.rawDir, { recursive: true });
}

function rawFile(paths, uuid) {
    return join(paths.rawDir, `${uuid}.txt`);
}

export async function readRawCache(paths, uuid) {
    try {
        return await readFile(rawFile(paths, uuid), 'utf8');
    } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

export async function writeRawCache(paths, uuid, text) {
    await writeFile(rawFile(paths, uuid), text, 'utf8');
}

export async function loadProgress(paths) {
    let contents;
    try {
        contents = await readFile(paths.progressFile, 'utf8');
    } catch (err) {
        if (err?.code === 'ENOENT') return new Map();
        throw err;
    }

    const progress = new Map();
    for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const entry = JSON.parse(trimmed);
            if (entry?.uuid) progress.set(entry.uuid, { status: entry.status, at: entry.at });
        } catch {
            // Ignore a torn final line from an interrupted run.
        }
    }
    return progress;
}

export async function appendProgress(paths, entry) {
    const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
    await appendFile(paths.progressFile, `${line}\n`, 'utf8');
}
