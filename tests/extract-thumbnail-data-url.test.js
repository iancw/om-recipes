import { describe, it, expect } from 'vitest';

import { extractExifOrientation, extractThumbnailDataUrl } from '../lib/exifparse.js';

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

describe('extractExifOrientation', () => {
    it('reads a numeric EXIF Orientation from exiftool JSON', () => {
        const json = JSON.stringify([{ SourceFile: '/photo.jpg', Orientation: 8 }]);

        expect(extractExifOrientation(json)).toBe(8);
    });

    it('reads a numeric Orientation supplied as a string', () => {
        const json = JSON.stringify([{ SourceFile: '/photo.jpg', Orientation: '6' }]);

        expect(extractExifOrientation(json)).toBe(6);
    });

    it('defaults to 1 (no rotation) when Orientation is absent', () => {
        expect(extractExifOrientation(JSON.stringify([{ SourceFile: '/photo.jpg' }]))).toBe(1);
    });

    it('defaults to 1 for malformed, empty, or out-of-range values', () => {
        expect(extractExifOrientation('not json {')).toBe(1);
        expect(extractExifOrientation('')).toBe(1);
        expect(extractExifOrientation(JSON.stringify([{ Orientation: 0 }]))).toBe(1);
        expect(extractExifOrientation(JSON.stringify([{ Orientation: 9 }]))).toBe(1);
        expect(extractExifOrientation(JSON.stringify([{ Orientation: 'Rotate 270 CW' }]))).toBe(1);
    });
});
