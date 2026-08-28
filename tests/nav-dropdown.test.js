import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

global.React = React;
afterAll(() => {
    delete global.React;
});

let pathname = '/';

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
}));

vi.mock('next/navigation', () => ({
    usePathname: () => pathname
}));

const items = [
    { href: '/how-to/om-workspace', linkText: 'OM Workspace processing' },
    { href: '/how-to/camera-from-jpg', linkText: 'JPG → Camera via Computer' }
];

async function render(props) {
    const { default: NavDropdown } = await import('../components/NavDropdown.jsx');
    return renderToStaticMarkup(React.createElement(NavDropdown, { label: 'Guides', items, ...props }));
}

afterEach(() => {
    pathname = '/';
    vi.resetModules();
});

describe('NavDropdown', () => {
    it('renders a menu-button trigger, closed by default', async () => {
        const markup = await render();

        expect(markup).toMatch(/<button[^>]*aria-haspopup="menu"/);
        expect(markup).toMatch(/<button[^>]*aria-expanded="false"/);
        expect(markup).toContain('Guides');
    });

    it('renders every item as a hidden menu link while closed', async () => {
        const markup = await render();

        for (const item of items) {
            expect(markup).toContain(`href="${item.href}"`);
            expect(markup).toContain(item.linkText);
        }
        // The panel is in the DOM but hidden until opened.
        expect(markup).toMatch(/hidden/);
    });

    it('flags itself active when the current path is one of its items', async () => {
        pathname = '/how-to/camera-from-jpg';
        const markup = await render();

        expect(markup).toMatch(/<button[^>]*data-active="true"/);
    });

    it('is not active on unrelated paths', async () => {
        pathname = '/about';
        const markup = await render();

        expect(markup).toMatch(/<button[^>]*data-active="false"/);
    });
});
