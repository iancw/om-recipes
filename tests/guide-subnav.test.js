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
    it('links to the hub and every guide page', () => {
        const markup = renderToStaticMarkup(React.createElement(GuideSubNav, {}));

        expect(markup).toContain('href="/how-to"');
        for (const page of GUIDE_PAGES) {
            expect(markup).toContain(`href="${page.href}"`);
        }
    });

    it('marks the current guide with aria-current="page"', () => {
        const markup = renderToStaticMarkup(
            React.createElement(GuideSubNav, { current: 'om-3-profiles' })
        );

        expect(markup).toMatch(/href="\/how-to\/om-3-profiles"[^>]*aria-current="page"/);
        expect(markup).not.toMatch(/href="\/how-to\/om-workspace"[^>]*aria-current="page"/);
    });

    it('marks the "All guides" pill current on the hub and no guide pill', () => {
        const markup = renderToStaticMarkup(
            React.createElement(GuideSubNav, { current: 'hub' })
        );

        expect(markup).toMatch(/href="\/how-to"[^>]*aria-current="page"/);
        for (const page of GUIDE_PAGES) {
            expect(markup).not.toMatch(
                new RegExp(`href="${page.href}"[^>]*aria-current="page"`)
            );
        }
    });
});
