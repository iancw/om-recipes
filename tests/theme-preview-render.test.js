import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('next/link');
    vi.doUnmock('components/HeaderNav');
    vi.resetModules();
    delete global.React;
});

describe('header theme integration', () => {
    it('renders the shared header without the temporary theme preview switcher controls', async () => {
        global.React = await import('react');

        vi.doMock('next/link', async () => {
            const { createElement } = await import('react');

            return {
                default: function MockLink({ children, href, ...props }) {
                    return createElement('a', { href, ...props }, children);
                }
            };
        });

        vi.doMock('components/HeaderNav', async () => {
            const { createElement } = await import('react');

            return {
                default: function MockHeaderNav() {
                    return createElement('div', { 'data-testid': 'header-nav' }, 'Header Nav');
                }
            };
        });

        const { createElement } = await import('react');
        const { renderToStaticMarkup } = await import('react-dom/server');
        const { Header } = await import('../components/header.jsx');

        const html = renderToStaticMarkup(createElement(Header));

        expect(html).toContain('Header Nav');
        expect(html).not.toContain('Default');
        expect(html).not.toContain('Cool Neutral');
        expect(html).not.toContain('Cloud Dancer Ink');
        expect(html).not.toContain('aria-pressed');
    });
});
