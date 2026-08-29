import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ContributeSamplesBannerContent } from '../components/ContributeSamplesBanner.jsx';

global.React = React;
afterAll(() => {
    delete global.React;
});

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

function render() {
    return renderToStaticMarkup(React.createElement(ContributeSamplesBannerContent, {}));
}

describe('ContributeSamplesBannerContent', () => {
    it('nudges visitors to contribute photos and points the CTA at the upload page', () => {
        const markup = render();

        expect(markup).toContain('straight-out-of-camera JPG');
        expect(markup).toMatch(/href="\/upload"/);
        expect(markup).toContain('Upload a JPG');
    });

    it('mentions both attaching a sample and creating a new recipe', () => {
        const markup = render();

        expect(markup).toContain('sample');
        expect(markup).toContain('new recipe');
    });

    it('offers a dismiss control', () => {
        expect(render()).toContain('aria-label="Dismiss"');
    });
});
