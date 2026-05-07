export const RECIPE_IMAGE_RENDITIONS = ['320', '640', '960', '1200', '1600', 'original'];

function trimTrailingSlash(value) {
    return String(value ?? '').replace(/\/+$/, '');
}

export function getRecipeImageAssetHost(env = process.env) {
    const explicit = String(env.NEXT_PUBLIC_IMAGE_ASSET_HOST ?? '').trim();
    return trimTrailingSlash(explicit || 'https://images.om-recipes.com');
}

export function getRecipeImageObjectKey(image = {}) {
    const prepared = String(image.preparedObjectKey ?? '').trim();
    if (prepared) return prepared;

    const legacy = [image.fullSizeUrl, image.smallUrl]
        .map((value) => String(value ?? '').trim())
        .find(Boolean);

    const match = legacy?.match(
        /^\/assets\/images\/(?:original|320|640|960|1200|1600|600)\/(.+)$/
    );
    return match ? match[1] : null;
}

export function buildRecipeImageAssetUrl({ assetHost, objectKey, rendition }) {
    const normalizedObjectKey = String(objectKey ?? '').trim();
    if (!normalizedObjectKey) return null;

    const normalizedRendition = String(rendition);
    if (!RECIPE_IMAGE_RENDITIONS.includes(normalizedRendition)) {
        throw new Error(`Unsupported rendition: ${rendition}`);
    }

    return `${trimTrailingSlash(assetHost || getRecipeImageAssetHost())}/${normalizedRendition}/${normalizedObjectKey}`;
}

export function hydrateRecipeImageRecord(image, { assetHost } = {}) {
    if (!image) return null;

    const objectKey = getRecipeImageObjectKey(image);
    if (!objectKey) {
        return { ...image, assetUrls: {} };
    }

    return {
        ...image,
        preparedObjectKey: objectKey,
        assetUrls: {
            320: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: '320' }),
            640: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: '640' }),
            960: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: '960' }),
            1200: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: '1200' }),
            1600: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: '1600' }),
            original: buildRecipeImageAssetUrl({ assetHost, objectKey, rendition: 'original' })
        }
    };
}
