import { describe, expect, it } from 'vitest';

import {
    createUploadPreviewUrls,
    shouldDisableUploadPreview
} from '../lib/upload-preview.js';

describe('shouldDisableUploadPreview', () => {
    it('disables preview when device memory is low', () => {
        expect(shouldDisableUploadPreview(1)).toBe(true);
        expect(shouldDisableUploadPreview(2)).toBe(true);
        expect(shouldDisableUploadPreview(4)).toBe(true);
    });

    it('allows preview when device memory is above the low-memory threshold', () => {
        expect(shouldDisableUploadPreview(8)).toBe(false);
    });

    it('allows preview when device memory is unavailable', () => {
        expect(shouldDisableUploadPreview(undefined)).toBe(false);
        expect(shouldDisableUploadPreview(null)).toBe(false);
    });

    it('disables preview on mobile Safari when memory info is unavailable and multiple files are selected', () => {
        expect(
            shouldDisableUploadPreview({
                deviceMemory: undefined,
                fileCount: 3,
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
            })
        ).toBe(true);
    });

    it('keeps preview enabled on mobile Safari for a single selected file', () => {
        expect(
            shouldDisableUploadPreview({
                deviceMemory: undefined,
                fileCount: 1,
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
            })
        ).toBe(false);
    });
});

describe('createUploadPreviewUrls', () => {
    it('creates previews sequentially so large batches do not decode concurrently', async () => {
        const files = [{ name: 'one.jpg' }, { name: 'two.jpg' }, { name: 'three.jpg' }];
        const started = [];
        const releases = [];
        const createPreviewUrl = (file) =>
            new Promise((resolve) => {
                started.push(file.name);
                releases.push(() => resolve(`blob:${file.name}`));
            });

        const promise = createUploadPreviewUrls(files, { createPreviewUrl });

        await Promise.resolve();
        expect(started).toEqual(['one.jpg']);

        releases.shift()();
        await Promise.resolve();
        expect(started).toEqual(['one.jpg', 'two.jpg']);

        releases.shift()();
        await Promise.resolve();
        expect(started).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);

        releases.shift()();
        await expect(promise).resolves.toEqual([
            'blob:one.jpg',
            'blob:two.jpg',
            'blob:three.jpg'
        ]);
    });
});
