'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

import { cn } from '../lib/cn.js';
import {
    buildRetryableImageUrl,
    startImageAvailabilityPolling
} from '../lib/recipe-preview-image-polling.js';

const RETRY_INTERVAL_MS = 5000;
const MAX_RETRY_DURATION_MS = 100000;

export default function RecipePreviewImage({
    src,
    alt,
    width = undefined,
    height = undefined,
    fill = false,
    priority = false,
    sizes,
    imageClassName,
    placeholderClassName,
    style,
    naturalSize = false,
    onLoad
}) {
    const [imageState, setImageState] = useState(() => ({
        trackedSrc: src,
        status: 'image',
        retryAttempt: 0
    }));

    const trackedSrcMatches = imageState.trackedSrc === src;
    const status = trackedSrcMatches ? imageState.status : 'image';
    const retryAttempt = trackedSrcMatches ? imageState.retryAttempt : 0;

    useEffect(() => {
        if (status !== 'processing' || !src || typeof window === 'undefined') {
            return undefined;
        }

        return startImageAvailabilityPolling({
            src,
            intervalMs: RETRY_INTERVAL_MS,
            maxDurationMs: MAX_RETRY_DURATION_MS,
            createImage: () => new window.Image(),
            onAvailable: (attempt) => {
                setImageState({
                    trackedSrc: src,
                    status: 'image',
                    retryAttempt: attempt
                });
            },
            onExhausted: () => {
                setImageState((current) => (
                    current.trackedSrc === src
                        ? { ...current, status: 'exhausted' }
                        : current
                ));
            }
        });
    }, [status, src]);

    const retryableSrc = useMemo(
        () => buildRetryableImageUrl(src, retryAttempt),
        [retryAttempt, src]
    );

    if (status === 'processing' || status === 'exhausted') {
        return (
            <div
                className={cn(
                    'flex flex-col items-center justify-center gap-3 px-6 text-center',
                    placeholderClassName
                )}
                role="status"
                aria-live="polite"
            >
                {status === 'processing' ? (
                    <span
                        aria-hidden="true"
                        className="h-8 w-8 animate-spin rounded-full border-2 border-current/25 border-t-current"
                    />
                ) : (
                    <span
                        aria-hidden="true"
                        className="h-8 w-8 rounded-full border-2 border-current/35"
                    />
                )}
                <div className="space-y-1">
                    <p className="text-sm font-medium">
                        {status === 'processing' ? 'Processing image…' : 'Image is still processing'}
                    </p>
                    <p className="text-xs leading-5 opacity-70">
                        {status === 'processing'
                            ? 'Checking again in a few seconds.'
                            : 'Please check back shortly.'}
                    </p>
                </div>
            </div>
        );
    }

    if (naturalSize) {
        return (
            <img
                src={retryableSrc}
                alt={alt}
                style={style}
                className={imageClassName}
                onLoad={onLoad}
                onError={() => setImageState({
                    trackedSrc: src,
                    status: 'processing',
                    retryAttempt
                })}
            />
        );
    }

    if (fill) {
        return (
            <Image
                src={retryableSrc}
                alt={alt}
                fill
                unoptimized
                sizes={sizes}
                priority={priority}
                style={style}
                className={imageClassName}
                onError={() => setImageState({
                    trackedSrc: src,
                    status: 'processing',
                    retryAttempt
                })}
            />
        );
    }

    return (
        <Image
            src={retryableSrc}
            alt={alt}
            width={width}
            height={height}
            unoptimized
            sizes={sizes}
            priority={priority}
            style={style}
            className={imageClassName}
            onError={() => setImageState({
                trackedSrc: src,
                status: 'processing',
                retryAttempt
            })}
        />
    );
}
