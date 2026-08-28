import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import RecipeSampleStrip from '../components/RecipeSampleStrip.jsx';

vi.mock('next/image', () => ({
    default: ({ unoptimized, priority, fill, ...props }) => React.createElement('img', props)
}));

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

function sampleImage(id, extra = {}) {
    return { id, smallUrl: `/assets/images/320/${id}.jpg`, ...extra };
}

describe('RecipeSampleStrip', () => {
    it('shows the primary image large and includes it as a thumbnail alongside the rest when they all fit', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [sampleImage('a'), sampleImage('b'), sampleImage('c')],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('alt="Recipe Sample Image"');
        expect(markup).toContain('Sample image');
        expect((markup.match(/aria-label="Sample image"/g) ?? []).length).toBe(3);
        expect(markup).not.toContain('/recipes/example');
    });

    it('reserves a slot for a linked "+N" tile when more images exist than fit', () => {
        const images = [sampleImage('primary')];
        for (let i = 0; i < 5; i += 1) images.push(sampleImage(`extra-${i}`));

        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images,
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('href="/recipes/example"');
        expect(markup).toContain('+3');
    });

    it('credits the sample author in the thumbnail label when known', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [sampleImage('a'), sampleImage('b', { sampleAuthor: { name: 'Jamie' } })],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('Sample by Jamie');
    });

    it('makes the primary image clickable in the thumbnail strip, not just the main preview', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [sampleImage('a'), sampleImage('b')],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('aria-pressed="true"');
    });

    it('labels a comparison image with its formatted label since it has no sample author', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [sampleImage('a'), sampleImage('b', { label: 'watch hill', sampleAuthor: undefined })],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('Comparison: Watch Hill');
    });

    it('shows the active image exposure metadata below the main image', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [
                    sampleImage('a', {
                        camera: 'OM-3',
                        lens: '25mm F1.8',
                        shutterSpeed: '1/250',
                        aperture: '4.0',
                        focalLength: '40.0 mm',
                        iso: '200'
                    }),
                    sampleImage('b')
                ],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toContain('OM-3 • 25mm F1.8 • 1/250s • f/4.0 • 40.0 mm • ISO 200');
    });

    it('omits the exposure metadata line when the active image has no EXIF', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [sampleImage('a'), sampleImage('b')],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).not.toContain('recipe-sample-exif');
    });

    it('returns nothing when there is no resolvable main image', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSampleStrip, {
                images: [{ id: 'no-url' }],
                recipeHref: '/recipes/example'
            })
        );

        expect(markup).toBe('');
    });
});
