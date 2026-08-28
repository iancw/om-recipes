import { GUIDE_PAGES } from './guide-pages.js';

// The "Guides" entry is a menu trigger, not a link — it has `children` and no
// `href`. Header nav components render it as a dropdown (desktop) or a
// collapsible group (mobile). Child labels come from GUIDE_PAGES so the
// dropdown, the in-page sub-nav and the hub cards all stay in sync.
const guidesNavItem = {
    linkText: 'Guides',
    children: GUIDE_PAGES.map((page) => ({ href: page.href, linkText: page.label }))
};

export const publicNavItems = [
    { linkText: 'Recipes', href: '/' },
    { linkText: 'Upload', href: '/upload' },
    guidesNavItem,
    { href: '/about', linkText: 'About' },
    { href: '/privacy', linkText: 'Privacy' },
    { href: '/terms', linkText: 'Terms' }
];

export const authedNavItems = [
    { linkText: 'Recipes', href: '/' },
    { linkText: 'Upload', href: '/upload' },
    { linkText: 'Samples', href: '/my-samples' },
    { linkText: 'Camera Settings', href: '/camera-settings' },
    { linkText: 'Profile', href: '/profile' },
    guidesNavItem,
    { href: '/about', linkText: 'About' },
    { href: '/privacy', linkText: 'Privacy' },
    { href: '/terms', linkText: 'Terms' }
];
