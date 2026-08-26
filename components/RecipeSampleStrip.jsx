'use client';

import React, { useState } from 'react';
import Link from 'next/link';

import RecipePreviewImage from './RecipePreviewImage.jsx';
import { formatComparisonImageLabelForDisplay, getImagePreviewUrl } from '../lib/recipe-image-selection.js';
import { cn } from '../lib/cn.js';

const THUMB_SIZE = 52;
const THUMB_GAP = 8;
const THUMB_SLOT = THUMB_SIZE + THUMB_GAP;
const MIN_THUMBNAIL_SLOTS = 2;
const MAX_THUMBNAIL_SLOTS = 6;
const MAIN_MAX_WIDTH = 320;
const MAIN_MAX_HEIGHT = 420;
const DEFAULT_MAIN_HEIGHT_GUESS = 260;

function countThumbnailsThatFit(height) {
    const raw = Math.floor((height + THUMB_GAP) / THUMB_SLOT);
    return Math.min(Math.max(raw, MIN_THUMBNAIL_SLOTS), MAX_THUMBNAIL_SLOTS);
}

// The photo's true aspect ratio is only known once it decodes, so the fit is a
// guess (DEFAULT_MAIN_HEIGHT_GUESS) until onLoad reports natural dimensions,
// letting a portrait sample claim more vertical room than a landscape one.
function computeDisplayHeight(naturalWidth, naturalHeight) {
    if (!naturalWidth || !naturalHeight) return DEFAULT_MAIN_HEIGHT_GUESS;
    const scale = Math.min(MAIN_MAX_WIDTH / naturalWidth, MAIN_MAX_HEIGHT / naturalHeight);
    return naturalHeight * scale;
}

function describeImage(image) {
    const authorName = typeof image?.sampleAuthor?.name === 'string' ? image.sampleAuthor.name.trim() : '';
    if (authorName) return `Sample by ${authorName}`;

    const comparisonLabel = typeof image?.label === 'string' ? image.label.trim() : '';
    if (comparisonLabel) return `Comparison: ${formatComparisonImageLabelForDisplay(comparisonLabel)}`;

    return 'Sample image';
}

export default function RecipeSampleStrip({ images, recipeHref }) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [mainHeight, setMainHeight] = useState(DEFAULT_MAIN_HEIGHT_GUESS);

    const visibleImages = Array.isArray(images) ? images : [];
    const activeImage = visibleImages[activeIndex] ?? visibleImages[0] ?? null;

    const fit = countThumbnailsThatFit(mainHeight);
    const showLinkTile = visibleImages.length > fit;
    const thumbnailImages = showLinkTile ? visibleImages.slice(0, Math.max(fit - 1, 0)) : visibleImages;
    const remainingCount = visibleImages.length - thumbnailImages.length;

    const mainUrl = getImagePreviewUrl(activeImage);
    if (!mainUrl) return null;

    const isShowingPrimary = activeIndex === 0;

    const handleMainImageLoad = (event) => {
        const img = event.target;
        setMainHeight(computeDisplayHeight(img?.naturalWidth, img?.naturalHeight));
    };

    return (
        <div className="flex items-start gap-2">
            <div className="flex flex-col gap-2">
                {thumbnailImages.map((image, index) => {
                    const thumbUrl = getImagePreviewUrl(image);
                    if (!thumbUrl) return null;

                    const thumbLabel = describeImage(image);

                    return (
                        <button
                            key={image?.id ?? index}
                            type="button"
                            onClick={() => setActiveIndex(index)}
                            title={thumbLabel}
                            aria-label={thumbLabel}
                            aria-pressed={activeIndex === index}
                            className={cn(
                                'shrink-0 overflow-hidden rounded-lg border transition-colors',
                                activeIndex === index
                                    ? 'border-primary'
                                    : 'border-border/60 hover:border-primary/60'
                            )}
                        >
                            <RecipePreviewImage
                                src={thumbUrl}
                                alt={thumbLabel}
                                width={THUMB_SIZE}
                                height={THUMB_SIZE}
                                imageClassName="object-cover"
                                placeholderClassName="bg-background/70"
                                style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                            />
                        </button>
                    );
                })}
                {showLinkTile && (
                    <Link
                        href={recipeHref}
                        title="See all samples on the full recipe page"
                        className="flex shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-xs font-medium text-muted-foreground no-underline transition-colors hover:border-primary/60 hover:text-foreground"
                        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                    >
                        +{remainingCount}
                    </Link>
                )}
            </div>
            <button
                type="button"
                onClick={() => setActiveIndex(0)}
                title={isShowingPrimary ? 'Recipe sample image' : 'Back to primary sample image'}
                aria-label={isShowingPrimary ? 'Recipe sample image' : 'Back to primary sample image'}
                className="inline-block cursor-pointer overflow-hidden rounded-xl border border-border/60 p-0"
            >
                <RecipePreviewImage
                    src={mainUrl}
                    alt="Recipe Sample Image"
                    naturalSize
                    onLoad={handleMainImageLoad}
                    imageClassName="block"
                    style={{ maxWidth: MAIN_MAX_WIDTH, maxHeight: MAIN_MAX_HEIGHT, width: 'auto', height: 'auto' }}
                    placeholderClassName="h-[260px] w-[320px]"
                />
            </button>
        </div>
    );
}
