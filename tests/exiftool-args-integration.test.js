import { readFileSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';
import { RECIPE_EXIFTOOL_ARGS, parseCameraMetadataFromExif, parseRecipeSettingsFromExif } from '../lib/exifparse.js';

// Unlike tests/exifparse.test.js (which feeds synthetic/fixture exiftool TEXT
// directly into the parse functions), this test exercises the real
// @uswriting/exiftool WASM binary with the production RECIPE_EXIFTOOL_ARGS
// tag-request list against a real sample JPG. This is the only place that
// catches a tag name in RECIPE_EXIFTOOL_ARGS that exiftool doesn't
// recognize — exiftool silently omits unrecognized -TagName args from its
// output rather than erroring, so a typo'd/invalid arg produces no failure
// signal anywhere else, only a silently-null field.

afterAll(async () => {
    await disposeExifTool().catch(() => {});
});

describe('RECIPE_EXIFTOOL_ARGS against the real exiftool binary', () => {
    it('resolves every requested tag to a real value for a real sample JPG', async () => {
        const buf = readFileSync('data/samples/OM_recipe_3.jpg');
        const file = new File([buf], 'OM_recipe_3.jpg', { type: 'image/jpeg' });

        const result = await parseMetadata(file, { args: RECIPE_EXIFTOOL_ARGS });

        expect(result?.success).toBe(true);

        const cameraMetadata = parseCameraMetadataFromExif(result.data);
        expect(cameraMetadata.camera).not.toBeNull();
        expect(cameraMetadata.lens).not.toBeNull();
        expect(cameraMetadata.shutterSpeed).not.toBeNull();
        expect(cameraMetadata.aperture).not.toBeNull();
        expect(cameraMetadata.focalLength).not.toBeNull();
        expect(cameraMetadata.iso).not.toBeNull();

        const recipeSettings = parseRecipeSettingsFromExif(result.data);
        expect(recipeSettings.cameraModelName).not.toBeNull();
    });
});
