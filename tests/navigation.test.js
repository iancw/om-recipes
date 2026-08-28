import { describe, expect, it } from 'vitest';

import { authedNavItems, publicNavItems } from '../lib/navigation.js';
import { GUIDE_PAGES } from '../lib/guide-pages.js';

describe('navigation items', () => {
    for (const [name, items] of [
        ['public', publicNavItems],
        ['authed', authedNavItems]
    ]) {
        describe(`${name} nav`, () => {
            const guides = items.find((item) => item.linkText === 'Guides');

            it('exposes a "Guides" menu entry with no direct link of its own', () => {
                expect(guides).toBeTruthy();
                expect(guides.href).toBeUndefined();
            });

            it('lists the four guide pages as children, in order, with the shared labels', () => {
                expect(guides.children).toEqual(
                    GUIDE_PAGES.map((page) => ({ href: page.href, linkText: page.label }))
                );
            });

            it('no longer has a plain nav link to the /how-to hub', () => {
                expect(items.some((item) => item.href === '/how-to')).toBe(false);
            });
        });
    }
});
