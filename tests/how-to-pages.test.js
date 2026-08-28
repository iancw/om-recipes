import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { GUIDE_PAGES } from '../lib/guide-pages.js';

global.React = React;
afterAll(() => {
    delete global.React;
});

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

vi.mock('next/image', () => ({
    default: ({ alt = '', src }) => React.createElement('img', { alt, src: String(src) })
}));

const GUIDE_MODULES = {
    'om-workspace': () => import('../app/how-to/om-workspace/page.jsx'),
    'camera-from-jpg': () => import('../app/how-to/camera-from-jpg/page.jsx'),
    'om-3-profiles': () => import('../app/how-to/om-3-profiles/page.jsx'),
    'how-profiles-work': () => import('../app/how-to/how-profiles-work/page.jsx')
};

describe('how-to hub page', () => {
    it('has a title and renders a card linking to every guide', async () => {
        const mod = await import('../app/how-to/page.jsx');

        expect(mod.metadata.title).toBeTruthy();

        const markup = renderToStaticMarkup(React.createElement(mod.default));

        expect(markup).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
        for (const page of GUIDE_PAGES) {
            expect(markup).toContain(`href="${page.href}"`);
            expect(markup).toContain(page.description);
        }
    });
});

describe('how-to guide pages', () => {
    for (const page of GUIDE_PAGES) {
        it(`${page.slug}: has a title and marks its own sub-nav pill current`, async () => {
            const mod = await GUIDE_MODULES[page.slug]();

            expect(mod.metadata.title).toBeTruthy();

            const markup = renderToStaticMarkup(React.createElement(mod.default));

            expect(markup).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
            expect(markup).toContain('aria-label="Guides"');
            expect(markup).toMatch(
                new RegExp(`href="${page.href}"[^>]*aria-current="page"`)
            );
        });
    }
});
