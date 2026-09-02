import { describe, it, expect } from 'vitest';

import { extractThumbnailDataUrl } from '../lib/exifparse.js';

describe('extractThumbnailDataUrl', () => {
    it('converts an exiftool "base64:" JSON thumbnail into an image data URL', () => {
        const json = JSON.stringify([
            { SourceFile: '/photo.jpg', ThumbnailImage: 'base64:/9j/2wCEAAIB' }
        ]);

        expect(extractThumbnailDataUrl(json)).toBe('data:image/jpeg;base64,/9j/2wCEAAIB');
    });

    it('passes through a thumbnail exiftool already emits as a data URL', () => {
        const json = JSON.stringify([
            { SourceFile: '/photo.jpg', ThumbnailImage: 'data:image/jpeg;base64,/9j/2wCEAAIB' }
        ]);

        expect(extractThumbnailDataUrl(json)).toBe('data:image/jpeg;base64,/9j/2wCEAAIB');
    });

    it('returns null when the JSON has no ThumbnailImage tag', () => {
        const json = JSON.stringify([{ SourceFile: '/photo.jpg' }]);

        expect(extractThumbnailDataUrl(json)).toBeNull();
    });

    it('returns null for an empty exiftool result array', () => {
        expect(extractThumbnailDataUrl('[]')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
        expect(extractThumbnailDataUrl('not json {')).toBeNull();
    });

    it('returns null for empty or missing input', () => {
        expect(extractThumbnailDataUrl('')).toBeNull();
        expect(extractThumbnailDataUrl(null)).toBeNull();
        expect(extractThumbnailDataUrl(undefined)).toBeNull();
    });

    it('returns null when the thumbnail value is present but blank', () => {
        const json = JSON.stringify([{ SourceFile: '/photo.jpg', ThumbnailImage: 'base64:' }]);

        expect(extractThumbnailDataUrl(json)).toBeNull();
    });
});
