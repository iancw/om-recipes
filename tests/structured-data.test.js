import { describe, expect, it } from 'vitest';

import { buildRecipeJsonLd, buildSiteJsonLd } from '../lib/structured-data.js';

const BASE_URL = 'https://www.omrecipes.dev';

function makeRecipe(overrides = {}) {
    return {
        slug: 'warm-summer',
        uuid: '11111111-1111-1111-1111-111111111111',
        type: 'COLOR',
        recipeName: 'Warm Summer',
        authorName: 'Jamie Rivers',
        description: 'A warm, golden look for bright afternoons.',
        sourceUrl: 'https://example.com/warm-summer',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        updatedAt: new Date('2026-03-04T05:06:07.000Z'),
        authorSocial: {
            instagram: 'https://instagram.com/jamie',
            flickr: null,
            website: 'https://jamie.example',
            kofi: null
        },
        sampleImages: [
            {
                isPrimary: false,
                dimensions: '1600x1200',
                assetUrls: {
                    320: 'https://images.test/320/a.jpg',
                    640: 'https://images.test/640/a.jpg',
                    original: 'https://images.test/a.jpg'
                },
                sampleAuthor: {
                    name: 'Sam Doe',
                    instagramLink: 'https://instagram.com/sam',
                    flickrLink: null,
                    website: null,
                    kofiLink: null
                }
            },
            {
                isPrimary: true,
                dimensions: '2000x1500',
                assetUrls: {
                    640: 'https://images.test/640/b.jpg',
                    original: 'https://images.test/b.jpg'
                },
                sampleAuthor: null
            }
        ],
        ...overrides
    };
}

describe('buildSiteJsonLd', () => {
    it('returns a WebSite and Organization graph anchored to the base URL', () => {
        const data = buildSiteJsonLd({ baseUrl: BASE_URL });

        expect(data['@context']).toBe('https://schema.org');
        const types = data['@graph'].map((node) => node['@type']);
        expect(types).toEqual(['WebSite', 'Organization']);

        const website = data['@graph'][0];
        expect(website.url).toBe('https://www.omrecipes.dev/');
        expect(website.name).toBe('OM Recipes');
        expect(website.publisher['@id']).toBe(data['@graph'][1]['@id']);

        const org = data['@graph'][1];
        expect(org.logo.url).toBe('https://www.omrecipes.dev/om1.png');
    });

    it('returns null when no base URL is configured', () => {
        expect(buildSiteJsonLd({ baseUrl: '' })).toBeNull();
        expect(buildSiteJsonLd({})).toBeNull();
    });
});

describe('buildRecipeJsonLd', () => {
    it('returns null without a base URL or recipe', () => {
        expect(buildRecipeJsonLd({ recipe: makeRecipe(), baseUrl: '' })).toBeNull();
        expect(buildRecipeJsonLd({ recipe: null, baseUrl: BASE_URL })).toBeNull();
    });

    it('builds a breadcrumb from Home to the recipe', () => {
        const data = buildRecipeJsonLd({ recipe: makeRecipe(), baseUrl: BASE_URL });
        const breadcrumb = data['@graph'].find((node) => node['@type'] === 'BreadcrumbList');

        expect(breadcrumb.itemListElement).toEqual([
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.omrecipes.dev/' },
            {
                '@type': 'ListItem',
                position: 2,
                name: 'Warm Summer',
                item: 'https://www.omrecipes.dev/recipes/warm-summer'
            }
        ]);
    });

    it('describes the recipe as a CreativeWork with canonical URL, dates and author', () => {
        const data = buildRecipeJsonLd({ recipe: makeRecipe(), baseUrl: BASE_URL });
        const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');

        expect(work.name).toBe('Warm Summer');
        expect(work.url).toBe('https://www.omrecipes.dev/recipes/warm-summer');
        expect(work.description).toBe('A warm, golden look for bright afternoons.');
        expect(work.dateCreated).toBe('2026-01-02T03:04:05.000Z');
        expect(work.dateModified).toBe('2026-03-04T05:06:07.000Z');
        expect(work.isBasedOn).toBe('https://example.com/warm-summer');
        expect(work.author).toEqual({
            '@type': 'Person',
            name: 'Jamie Rivers',
            sameAs: ['https://instagram.com/jamie', 'https://jamie.example']
        });
        expect(work.keywords).toContain('color recipe');
    });

    it('falls back to a generated description and createdAt for dateModified', () => {
        const recipe = makeRecipe({ description: '  ', updatedAt: null, type: 'MONO' });
        const data = buildRecipeJsonLd({ recipe, baseUrl: BASE_URL });
        const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');

        expect(work.description).toBe(
            'Monochrome recipe for OM System / Olympus cameras by Jamie Rivers.'
        );
        expect(work.dateModified).toBe('2026-01-02T03:04:05.000Z');
        expect(work.keywords).toContain('monochrome recipe');
    });

    it('emits an ImageObject per sample with dimensions, credit and primary flag', () => {
        const data = buildRecipeJsonLd({ recipe: makeRecipe(), baseUrl: BASE_URL });
        const images = data['@graph'].filter((node) => node['@type'] === 'ImageObject');

        expect(images).toHaveLength(2);

        const [first, second] = images;
        expect(first.contentUrl).toBe('https://images.test/a.jpg');
        expect(first.thumbnailUrl).toBe('https://images.test/640/a.jpg');
        expect(first.width).toBe(1600);
        expect(first.height).toBe(1200);
        expect(first.creator).toEqual({
            '@type': 'Person',
            name: 'Sam Doe',
            sameAs: ['https://instagram.com/sam']
        });
        expect(first.creditText).toBe('Sam Doe');
        expect(first.representativeOfPage).toBeUndefined();

        expect(second.representativeOfPage).toBe(true);
        expect(second.creator).toBeUndefined();
    });

    it('reads sample dimensions from either a "WxH" string or a {width,height} object', () => {
        const recipe = makeRecipe({
            sampleImages: [
                {
                    isPrimary: false,
                    dimensions: { width: 4000, height: 3000 },
                    assetUrls: { original: 'https://images.test/obj.jpg' },
                    sampleAuthor: null
                },
                {
                    isPrimary: false,
                    dimensions: '800x600',
                    assetUrls: { original: 'https://images.test/str.jpg' },
                    sampleAuthor: null
                }
            ]
        });
        const data = buildRecipeJsonLd({ recipe, baseUrl: BASE_URL });
        const images = data['@graph'].filter((node) => node['@type'] === 'ImageObject');

        expect([images[0].width, images[0].height]).toEqual([4000, 3000]);
        expect([images[1].width, images[1].height]).toEqual([800, 600]);
    });

    it('links the CreativeWork image list to the ImageObject nodes by id', () => {
        const data = buildRecipeJsonLd({ recipe: makeRecipe(), baseUrl: BASE_URL });
        const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');
        const imageIds = data['@graph']
            .filter((node) => node['@type'] === 'ImageObject')
            .map((node) => node['@id']);

        expect(work.image.map((ref) => ref['@id'])).toEqual(imageIds);
    });

    it('omits image data and isBasedOn when the recipe has neither', () => {
        const recipe = makeRecipe({ sampleImages: [], sourceUrl: null });
        const data = buildRecipeJsonLd({ recipe, baseUrl: BASE_URL });
        const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');

        expect(data['@graph'].some((node) => node['@type'] === 'ImageObject')).toBe(false);
        expect(work.image).toBeUndefined();
        expect(work.isBasedOn).toBeUndefined();
    });

    it('skips samples that have no rendered original asset', () => {
        const recipe = makeRecipe({
            sampleImages: [
                { isPrimary: false, dimensions: null, assetUrls: {}, sampleAuthor: null },
                {
                    isPrimary: false,
                    dimensions: null,
                    assetUrls: { original: 'https://images.test/only.jpg' },
                    sampleAuthor: null
                }
            ]
        });
        const data = buildRecipeJsonLd({ recipe, baseUrl: BASE_URL });
        const images = data['@graph'].filter((node) => node['@type'] === 'ImageObject');

        expect(images).toHaveLength(1);
        expect(images[0].contentUrl).toBe('https://images.test/only.jpg');
        expect(images[0].thumbnailUrl).toBe('https://images.test/only.jpg');
    });

    it('uses the uuid in the canonical URL when the slug is missing', () => {
        const recipe = makeRecipe({ slug: null });
        const data = buildRecipeJsonLd({ recipe, baseUrl: BASE_URL });
        const work = data['@graph'].find((node) => node['@type'] === 'CreativeWork');

        expect(work.url).toBe(
            'https://www.omrecipes.dev/recipes/11111111-1111-1111-1111-111111111111'
        );
    });
});
