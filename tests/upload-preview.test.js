import { describe, expect, it } from 'vitest';

import { shouldDisableUploadPreview } from '../lib/upload-preview.js';

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
});
