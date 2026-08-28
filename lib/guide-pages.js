// Shared definition of the /how-to guide pages. Consumed by the how-to hub
// page (cards), the GuideSubNav strip (cross-links), and the sitemap. Keep the
// order here — it drives the order pages appear in the hub and sub-nav.

export const GUIDE_PAGES = [
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
    },
    {
        slug: 'om-3-profiles',
        href: '/how-to/om-3-profiles',
        label: 'Manually into camera',
        description: 'Type a recipe into the OM-3 by hand using the Creative Dial.'
    },
    {
        slug: 'how-profiles-work',
        href: '/how-to/how-profiles-work',
        label: 'What are OM color profiles',
        description: 'What the color wheel, tone curve, white balance and profile slots actually do.'
    }
];
