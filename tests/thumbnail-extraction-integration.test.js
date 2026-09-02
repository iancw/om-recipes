import { readFileSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';

import { THUMBNAIL_EXIFTOOL_ARGS, extractThumbnailDataUrl } from '../lib/exifparse.js';

// Exercises the real @uswriting/exiftool WASM binary: the upload preview now
// relies on the JPEG's embedded EXIF thumbnail instead of decoding the
// full-resolution original in the browser, so a real SOOC sample must yield a
// usable image data URL through THUMBNAIL_EXIFTOOL_ARGS + extractThumbnailDataUrl.

afterAll(async () => {
    await disposeExifTool().catch(() => {});
});

describe('embedded thumbnail extraction against the real exiftool binary', () => {
    it('produces a decodable JPEG data URL for a real SOOC sample JPG', async () => {
        const buf = readFileSync('data/samples/OM_recipe_3.jpg');
        const file = new File([buf], 'OM_recipe_3.jpg', { type: 'image/jpeg' });

        const result = await parseMetadata(file, { args: THUMBNAIL_EXIFTOOL_ARGS });
        expect(result?.success).toBe(true);

        const dataUrl = extractThumbnailDataUrl(result.data);
        expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);

        const base64 = dataUrl.slice('data:image/jpeg;base64,'.length);
        const bytes = Buffer.from(base64, 'base64');
        // JPEG start-of-image marker.
        expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
        // A real embedded thumbnail is a non-trivial number of bytes but far
        // smaller than the full image.
        expect(bytes.length).toBeGreaterThan(512);
        expect(bytes.length).toBeLessThan(buf.length);
    });
});
