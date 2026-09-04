import { readFileSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';

import {
    EXIF_HEAD_SLICE_BYTES,
    RECIPE_EXIFTOOL_ARGS,
    THUMBNAIL_EXIFTOOL_ARGS,
    extractExifOrientation,
    extractThumbnailDataUrl,
    hasDetectedRecipe,
    headSliceForExif,
    parseCameraMetadataFromExif,
    parseRecipeSettingsFromExif
} from '../lib/exifparse.js';

// Guards, against the real exiftool binary, that parsing only the head slice of
// a real multi-MB OM-3 JPEG gives the same result as parsing the whole file.

afterAll(async () => {
    await disposeExifTool().catch(() => {});
});

async function recipeFrom(input) {
    const result = await parseMetadata(input, { args: RECIPE_EXIFTOOL_ARGS });
    expect(result?.success).toBe(true);
    return {
        settings: parseRecipeSettingsFromExif(result.data),
        camera: parseCameraMetadataFromExif(result.data)
    };
}

describe('head-slice EXIF parsing against the real exiftool binary', () => {
    for (const name of ['OM_recipe_3.jpg', 'OM_recipe_2.jpg', 'OM_recipe_8.jpg']) {
        it(`matches the full-file parse for ${name}`, async () => {
            const buf = readFileSync(`data/samples/${name}`);
            const fullFile = new File([buf], name, { type: 'image/jpeg' });
            const sliced = new File([buf.subarray(0, EXIF_HEAD_SLICE_BYTES)], name, { type: 'image/jpeg' });

            const full = await recipeFrom(fullFile);
            const head = await recipeFrom(sliced);

            expect(head.settings).toEqual(full.settings);
            expect(head.camera).toEqual(full.camera);
            expect(hasDetectedRecipe(head.settings)).toBe(true);

            const fullThumb = await parseMetadata(fullFile, { args: THUMBNAIL_EXIFTOOL_ARGS });
            const headThumb = await parseMetadata(sliced, { args: THUMBNAIL_EXIFTOOL_ARGS });
            expect(extractExifOrientation(headThumb.data)).toBe(extractExifOrientation(fullThumb.data));
            expect(Boolean(extractThumbnailDataUrl(headThumb.data))).toBe(true);
        });
    }

    it('headSliceForExif trims the multi-MB sample down to the slice size', () => {
        const buf = readFileSync('data/samples/OM_recipe_3.jpg');
        const file = new File([buf], 'OM_recipe_3.jpg', { type: 'image/jpeg' });

        expect(file.size).toBeGreaterThan(EXIF_HEAD_SLICE_BYTES);
        const head = headSliceForExif(file);
        expect(head).not.toBe(file);
        expect(head.size).toBe(EXIF_HEAD_SLICE_BYTES);
    });
});
