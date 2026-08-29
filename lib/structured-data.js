const SCHEMA_CONTEXT = 'https://schema.org';
const SITE_NAME = 'OM Recipes';
const SITE_DESCRIPTION =
    'Discover and share color and monochrome recipes for OM System and Olympus cameras.';

function trimTrailingSlashes(value) {
    return String(value ?? '').replace(/\/+$/, '');
}

function toIsoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDimensions(value) {
    if (value && typeof value === 'object') {
        const width = Number(value.width);
        const height = Number(value.height);
        return width > 0 && height > 0 ? { width, height } : null;
    }
    const match = String(value ?? '')
        .trim()
        .match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function buildPerson(name, links = []) {
    const sameAs = links
        .map((link) => (typeof link === 'string' ? link.trim() : ''))
        .filter(Boolean);
    const person = { '@type': 'Person', name };
    if (sameAs.length > 0) person.sameAs = sameAs;
    return person;
}

/**
 * WebSite + Organization graph for the site as a whole. Rendered once in the
 * root layout. Returns null when APP_BASE_URL is not configured, since JSON-LD
 * needs absolute URLs to be useful.
 */
export function buildSiteJsonLd({ baseUrl } = {}) {
    const base = trimTrailingSlashes(baseUrl);
    if (!base) return null;

    const organizationId = `${base}/#organization`;

    return {
        '@context': SCHEMA_CONTEXT,
        '@graph': [
            {
                '@type': 'WebSite',
                '@id': `${base}/#website`,
                url: `${base}/`,
                name: SITE_NAME,
                description: SITE_DESCRIPTION,
                publisher: { '@id': organizationId }
            },
            {
                '@type': 'Organization',
                '@id': organizationId,
                name: SITE_NAME,
                url: `${base}/`,
                logo: {
                    '@type': 'ImageObject',
                    url: `${base}/om1.png`
                }
            }
        ]
    };
}

/**
 * BreadcrumbList + CreativeWork + one ImageObject per copyright-cleared sample
 * image for a single recipe detail page. Returns null without a base URL or
 * recipe.
 */
export function buildRecipeJsonLd({ recipe, baseUrl } = {}) {
    const base = trimTrailingSlashes(baseUrl);
    if (!base || !recipe) return null;

    const identifier = recipe.slug ?? recipe.uuid;
    const recipeUrl = `${base}/recipes/${encodeURIComponent(identifier)}`;
    const recipeId = `${recipeUrl}#recipe`;
    const isMono = String(recipe.type ?? '').toUpperCase() === 'MONO';

    const samples = Array.isArray(recipe.sampleImages) ? recipe.sampleImages : [];
    const imageNodes = samples
        .map((image, index) => {
            const contentUrl = image?.assetUrls?.original;
            if (!contentUrl) return null;

            const dimensions = parseDimensions(image.dimensions);
            const node = {
                '@type': 'ImageObject',
                '@id': `${recipeUrl}#sample-${index + 1}`,
                contentUrl,
                url: contentUrl,
                thumbnailUrl:
                    image.assetUrls['640'] ?? image.assetUrls['320'] ?? contentUrl,
                isPartOf: { '@id': recipeId }
            };

            if (dimensions) {
                node.width = dimensions.width;
                node.height = dimensions.height;
            }
            if (image.isPrimary) {
                node.representativeOfPage = true;
            }

            const sampleAuthorName = image?.sampleAuthor?.name;
            if (sampleAuthorName) {
                node.creator = buildPerson(sampleAuthorName, [
                    image.sampleAuthor.instagramLink,
                    image.sampleAuthor.flickrLink,
                    image.sampleAuthor.website,
                    image.sampleAuthor.kofiLink
                ]);
                node.creditText = sampleAuthorName;
                node.copyrightNotice = `© ${sampleAuthorName}`;
            }

            return node;
        })
        .filter(Boolean);

    const description =
        recipe.description?.trim() ||
        `${isMono ? 'Monochrome' : 'Color'} recipe for OM System / Olympus cameras by ${recipe.authorName}.`;

    const dateCreated = toIsoDate(recipe.createdAt);
    const dateModified = toIsoDate(recipe.updatedAt) ?? dateCreated;

    const creativeWork = {
        '@type': 'CreativeWork',
        '@id': recipeId,
        name: recipe.recipeName,
        description,
        url: recipeUrl,
        author: buildPerson(recipe.authorName, [
            recipe.authorSocial?.instagram,
            recipe.authorSocial?.flickr,
            recipe.authorSocial?.website,
            recipe.authorSocial?.kofi
        ]),
        keywords: [
            isMono ? 'monochrome recipe' : 'color recipe',
            'OM System',
            'Olympus',
            'camera recipe'
        ].join(', '),
        isPartOf: { '@id': `${base}/#website` }
    };

    if (dateCreated) creativeWork.dateCreated = dateCreated;
    if (dateModified) creativeWork.dateModified = dateModified;
    if (recipe.sourceUrl?.trim()) creativeWork.isBasedOn = recipe.sourceUrl.trim();
    if (imageNodes.length > 0) {
        creativeWork.image = imageNodes.map((node) => ({ '@id': node['@id'] }));
    }

    const breadcrumb = {
        '@type': 'BreadcrumbList',
        '@id': `${recipeUrl}#breadcrumb`,
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
            {
                '@type': 'ListItem',
                position: 2,
                name: recipe.recipeName,
                item: recipeUrl
            }
        ]
    };

    return {
        '@context': SCHEMA_CONTEXT,
        '@graph': [breadcrumb, creativeWork, ...imageNodes]
    };
}
