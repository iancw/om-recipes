import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

import GuideLayout from '../app/how-to/_components/GuideLayout.jsx';

global.React = React;
afterAll(() => {
    delete global.React;
});

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

describe('GuideLayout', () => {
    it('renders the title as an h1, the intro, and the guide sub-nav', () => {
        const markup = renderToStaticMarkup(
            React.createElement(
                GuideLayout,
                { current: 'om-workspace', title: 'Using OM Workspace', intro: 'An intro line.' },
                React.createElement('p', null, 'Body content')
            )
        );

        expect(markup).toMatch(/<h1[^>]*>Using OM Workspace<\/h1>/);
        expect(markup).toContain('An intro line.');
        expect(markup).toContain('Body content');
        expect(markup).toContain('aria-label="Guides"');
        expect(markup).toMatch(/href="\/how-to\/om-workspace"[^>]*aria-current="page"/);
    });
});
