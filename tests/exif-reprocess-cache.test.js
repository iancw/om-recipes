import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    cachePaths,
    ensureCacheDirs,
    readRawCache,
    writeRawCache,
    loadProgress,
    appendProgress
} from '../lib/exif-reprocess-cache.js';

let base;
let paths;

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'exif-reprocess-'));
    paths = cachePaths(base);
    await ensureCacheDirs(paths);
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

describe('cachePaths', () => {
    it('roots everything under <base>/.exif-reprocess', () => {
        expect(paths.root).toBe(join(base, '.exif-reprocess'));
        expect(paths.rawDir).toBe(join(base, '.exif-reprocess', 'raw'));
        expect(paths.progressFile).toBe(join(base, '.exif-reprocess', 'progress.jsonl'));
        expect(paths.reportFile).toBe(join(base, '.exif-reprocess', 'report.json'));
    });
});

describe('raw cache', () => {
    it('returns null for a missing entry', async () => {
        expect(await readRawCache(paths, 'nope')).toBeNull();
    });

    it('round-trips text', async () => {
        await writeRawCache(paths, 'abc', 'Camera Model Name : OM-3\n');
        expect(await readRawCache(paths, 'abc')).toBe('Camera Model Name : OM-3\n');
    });
});

describe('progress log', () => {
    it('returns an empty map when the file does not exist', async () => {
        expect(await loadProgress(paths)).toEqual(new Map());
    });

    it('appends JSON lines with a timestamp and keeps the last status per uuid', async () => {
        await appendProgress(paths, { uuid: 'a', imageId: 1, status: 'download_failed' });
        await appendProgress(paths, { uuid: 'a', imageId: 1, status: 'ok' });
        await appendProgress(paths, { uuid: 'b', imageId: 2, status: 'ok' });

        const progress = await loadProgress(paths);
        expect(progress.get('a').status).toBe('ok');
        expect(progress.get('b').status).toBe('ok');
        expect(typeof progress.get('a').at).toBe('string');

        const rawLines = (await readFile(paths.progressFile, 'utf8')).trim().split('\n');
        expect(rawLines).toHaveLength(3);
        expect(JSON.parse(rawLines[0])).toMatchObject({ uuid: 'a', imageId: 1, status: 'download_failed' });
    });
});
