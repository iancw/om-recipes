import { describe, expect, it } from 'vitest';

import { GUIDE_PAGES } from '../lib/guide-pages.js';

describe('GUIDE_PAGES', () => {
    it('lists the how-to guide pages nested under /how-to', () => {
        expect(GUIDE_PAGES.map((page) => page.href)).toEqual([
            '/how-to/om-workspace',
            '/how-to/camera-from-jpg'
        ]);
    });

    it('gives every guide a stable slug matching the last path segment', () => {
        for (const page of GUIDE_PAGES) {
            expect(page.href).toBe(`/how-to/${page.slug}`);
        }
    });

    it('uses the site-wide guide labels', () => {
        expect(GUIDE_PAGES.map((page) => page.label)).toEqual([
            'OM Workspace processing',
            'JPG → Camera via Computer'
        ]);
    });

    it('gives every guide a non-empty short description', () => {
        for (const page of GUIDE_PAGES) {
            expect(page.description.length).toBeGreaterThan(0);
        }
    });
});
