// Shared definition of the /how-to guide pages. Consumed by the how-to hub
// page (cards), the GuideSubNav strip (cross-links), and the sitemap. Keep the
// order here — it drives the order pages appear in the hub and sub-nav.

export const GUIDE_PAGES = [
    {
        slug: 'how-recipes-work',
        href: '/how-to/how-recipes-work',
        label: 'How color recipes work',
        description:
            'Background on the OM System creative dial, color profiles, and how this site fits in.'
    },
    {
        slug: 'manual-entry',
        href: '/how-to/manual-entry',
        label: 'Manual recipe entry',
        description: 'Dial a color profile into the camera by hand using the on-camera controls.'
    },
    {
        slug: 'custom-modes',
        href: '/how-to/custom-modes',
        label: 'Custom dial modes',
        description:
            'How the C1–C5 custom modes store color profiles and white balance, and how to keep track.'
    },
    {
        slug: 'om-workspace',
        href: '/how-to/om-workspace',
        label: 'OM Workspace processing',
        description: 'Apply a recipe to raw files with an OM Workspace batch processing file.'
    },
    {
        slug: 'camera-from-jpg',
        href: '/how-to/camera-from-jpg',
        label: 'JPG → Camera via Computer',
        description: 'Write a recipe straight to your camera from a straight-out-of-camera JPG.'
    }
];
