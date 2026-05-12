export const SAMPLE_IMAGE_SELECTION = 'sample';

export function comparisonImageSelectionValue(label) {
    const normalizedLabel = typeof label === 'string' ? label.trim() : '';
    return normalizedLabel ? `comparison:${normalizedLabel}` : null;
}

function normalizeLabel(label) {
    return typeof label === 'string' ? label.trim().toLowerCase() : '';
}

function isVisibleImage(image) {
    return image?.copyright !== false;
}

export function getComparisonLabelFromSelection(selection) {
    if (typeof selection !== 'string') return null;
    if (!selection.startsWith('comparison:')) return null;

    const label = selection.slice('comparison:'.length).trim();
    return label || null;
}

export function getAvailableComparisonImageLabels(recipesList) {
    const seen = new Set();
    const labels = [];

    for (const recipe of recipesList ?? []) {
        for (const image of recipe?.comparisonImages ?? []) {
            if (!isVisibleImage(image)) continue;
            const rawLabel = typeof image?.label === 'string' ? image.label.trim() : '';
            if (!rawLabel) continue;

            const normalized = normalizeLabel(rawLabel);
            if (!normalized || seen.has(normalized)) continue;

            seen.add(normalized);
            labels.push(rawLabel);
        }
    }

    return labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function formatComparisonImageLabelForDisplay(label) {
    const normalizedLabel = typeof label === 'string' ? label.trim() : '';
    if (!normalizedLabel) return '';

    return normalizedLabel
        .replace(/[-_]/g, ' ')
        .replace(/\b\w+/g, (word) => {
            const [first = '', ...rest] = word;
            return first.toUpperCase() + rest.join('').toLowerCase();
        });
}

export function getPrimarySampleImage(recipe) {
    const sampleImages = Array.isArray(recipe?.sampleImages)
        ? recipe.sampleImages.filter(isVisibleImage)
        : [];
    return sampleImages.find((image) => image?.isPrimary === true) ?? sampleImages[0] ?? null;
}

export function getRecipePreviewImage(recipe, selection = SAMPLE_IMAGE_SELECTION) {
    if (selection === SAMPLE_IMAGE_SELECTION) {
        return getPrimarySampleImage(recipe);
    }

    const comparisonLabel = getComparisonLabelFromSelection(selection);
    if (!comparisonLabel) {
        return getPrimarySampleImage(recipe);
    }

    const normalizedTarget = normalizeLabel(comparisonLabel);
    return (
        recipe?.comparisonImages?.find(
            (image) => isVisibleImage(image) && normalizeLabel(image?.label) === normalizedTarget
        ) ?? null
    );
}

export function getRecipeDownloadImage(recipe) {
    return (
        recipe?.sampleImages?.find((image) => isVisibleImage(image) && image?.validExif === true) ?? null
    );
}

function getAssetUrl(image, renditions) {
    for (const rendition of renditions) {
        const assetUrl = image?.assetUrls?.[rendition];
        if (assetUrl) return assetUrl;
    }

    return null;
}

function getLegacyRenditionUrl(image, rendition) {
    const fullSizeUrl = image?.fullSizeUrl;
    if (
        typeof fullSizeUrl === 'string' &&
        fullSizeUrl.startsWith('/assets/images/original/')
    ) {
        return fullSizeUrl.replace('/assets/images/original/', `/assets/images/${rendition}/`);
    }

    return null;
}

export function getImagePreviewUrl(image) {
    if (!isVisibleImage(image)) return null;
    return (
        getAssetUrl(image, [640, 960, 320, 'original']) ??
        image?.smallUrl ??
        image?.fullSizeUrl ??
        null
    );
}

export function getRecipeCardPreviewUrl(recipe, selection = SAMPLE_IMAGE_SELECTION) {
    const image = getRecipePreviewImage(recipe, selection);
    return getImagePreviewUrl(image);
}

export function getRecipeModalImageUrl(image) {
    if (!isVisibleImage(image)) return null;
    return (
        getAssetUrl(image, [1200, 1600, 'original']) ??
        getLegacyRenditionUrl(image, '1200') ??
        image?.fullSizeUrl ??
        image?.smallUrl ??
        null
    );
}

export function getRecipeDownloadUrl(recipe) {
    const image = getRecipeDownloadImage(recipe);
    return (
        getAssetUrl(image, ['original']) ??
        image?.fullSizeUrl ??
        image?.smallUrl ??
        null
    );
}
