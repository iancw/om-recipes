import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';

import { JsonLd } from '../components/JsonLd.jsx';

global.React = React;
afterAll(() => {
    delete global.React;
});

describe('JsonLd', () => {
    it('renders a application/ld+json script with the serialized data', () => {
        const markup = renderToStaticMarkup(
            React.createElement(JsonLd, { data: { '@type': 'WebSite', name: 'OM Recipes' } })
        );

        expect(markup).toBe(
            '<script type="application/ld+json">{"@type":"WebSite","name":"OM Recipes"}</script>'
        );
    });

    it('escapes angle brackets so page content cannot break out of the script', () => {
        const markup = renderToStaticMarkup(
            React.createElement(JsonLd, { data: { name: '</script><script>alert(1)' } })
        );

        expect(markup).not.toContain('</script><script>');
        expect(markup).toContain('\\u003c/script');
    });

    it('renders nothing when data is null', () => {
        const markup = renderToStaticMarkup(React.createElement(JsonLd, { data: null }));
        expect(markup).toBe('');
    });
});
