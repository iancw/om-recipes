import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { GUIDE_PAGES } from '../lib/guide-pages.js';
import GuideSubNav from '../app/how-to/_components/GuideSubNav.jsx';

global.React = React;
afterAll(() => {
    delete global.React;
});

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

describe('GuideSubNav', () => {
    it('links to every guide page and not to the hub', () => {
        const markup = renderToStaticMarkup(React.createElement(GuideSubNav, {}));

        for (const page of GUIDE_PAGES) {
            expect(markup).toContain(`href="${page.href}"`);
        }
        expect(markup).not.toContain('href="/how-to"');
    });

    it('shows the shared guide labels', () => {
        const markup = renderToStaticMarkup(React.createElement(GuideSubNav, {}));

        for (const page of GUIDE_PAGES) {
            expect(markup).toContain(page.label);
        }
    });

    it('marks the current guide with aria-current="page"', () => {
        const markup = renderToStaticMarkup(
            React.createElement(GuideSubNav, { current: 'om-3-profiles' })
        );

        expect(markup).toMatch(/href="\/how-to\/om-3-profiles"[^>]*aria-current="page"/);
        expect(markup).not.toMatch(/href="\/how-to\/om-workspace"[^>]*aria-current="page"/);
    });
});
