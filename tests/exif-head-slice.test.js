import { describe, it, expect } from 'vitest';

import {
    EXIF_HEAD_SLICE_BYTES,
    RECIPE_EXIFTOOL_ARGS,
    hasDetectedRecipe,
    headSliceForExif
} from '../lib/exifparse.js';

describe('headSliceForExif', () => {
    it('returns a file smaller than the slice size untouched', () => {
        const file = new File([new Uint8Array(2048)], 'small.jpg', { type: 'image/jpeg' });

        expect(headSliceForExif(file)).toBe(file);
    });

    it('slices a large file down to its leading bytes, keeping name and type', () => {
        const file = new File([new Uint8Array(EXIF_HEAD_SLICE_BYTES * 3)], 'big.jpg', { type: 'image/jpeg' });

        const head = headSliceForExif(file);

        expect(head).not.toBe(file);
        expect(head.name).toBe('big.jpg');
        expect(head.type).toBe('image/jpeg');
        expect(head.size).toBe(EXIF_HEAD_SLICE_BYTES);
    });

    it('respects an explicit byte count', () => {
        const file = new File([new Uint8Array(10_000)], 'x.jpg', { type: 'image/jpeg' });

        expect(headSliceForExif(file, 256).size).toBe(256);
    });

    it('returns the input unchanged when it cannot be sliced', () => {
        const notAFile = { name: 'x.jpg' };

        expect(headSliceForExif(notAFile)).toBe(notAFile);
        expect(headSliceForExif(null)).toBeNull();
    });
});

describe('RECIPE_EXIFTOOL_ARGS', () => {
    it('uses -fast (not -fast2, which drops Olympus maker notes)', () => {
        expect(RECIPE_EXIFTOOL_ARGS).toContain('-fast');
        expect(RECIPE_EXIFTOOL_ARGS).not.toContain('-fast2');
    });
});

describe('hasDetectedRecipe', () => {
    it('is true when either colour or monochrome profile settings are present', () => {
        expect(hasDetectedRecipe({ hasColorProfileSettings: true })).toBe(true);
        expect(hasDetectedRecipe({ hasMonochromeProfileSettings: true })).toBe(true);
    });

    it('is false for missing, empty, or profile-less settings', () => {
        expect(hasDetectedRecipe(null)).toBe(false);
        expect(hasDetectedRecipe({})).toBe(false);
        expect(hasDetectedRecipe({ hasColorProfileSettings: false, hasMonochromeProfileSettings: false })).toBe(false);
    });
});
