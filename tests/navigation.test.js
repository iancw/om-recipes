import { describe, expect, it } from 'vitest';

import { authedNavItems, publicNavItems } from '../lib/navigation.js';

describe('navigation items', () => {
    it('exposes the how-to hub under a "Guides" label for signed-out visitors', () => {
        const guides = publicNavItems.find((item) => item.href === '/how-to');

        expect(guides).toEqual({ href: '/how-to', linkText: 'Guides' });
    });

    it('exposes the how-to hub under a "Guides" label for signed-in users', () => {
        const guides = authedNavItems.find((item) => item.href === '/how-to');

        expect(guides).toEqual({ href: '/how-to', linkText: 'Guides' });
    });

    it('no longer labels any nav item "How-to"', () => {
        const labels = [...publicNavItems, ...authedNavItems].map((item) => item.linkText);

        expect(labels).not.toContain('How-to');
    });
});
