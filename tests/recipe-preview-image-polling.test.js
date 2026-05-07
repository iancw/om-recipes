import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildRetryableImageUrl,
    startImageAvailabilityPolling
} from '../lib/recipe-preview-image-polling.js';

describe('recipe preview image polling helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('adds a retry parameter while preserving existing query strings and hashes', () => {
        expect(buildRetryableImageUrl('/assets/images/640/sample.jpg', 0)).toBe('/assets/images/640/sample.jpg');
        expect(buildRetryableImageUrl('/assets/images/640/sample.jpg?foo=bar#preview', 3)).toBe(
            '/assets/images/640/sample.jpg?foo=bar&retry=3#preview'
        );
        expect(buildRetryableImageUrl('https://images.om-recipes.com/640/sample.jpg', 2)).toBe(
            'https://images.om-recipes.com/640/sample.jpg?retry=2'
        );
    });

    it('polls every 5 seconds until the image becomes available', () => {
        const attempts = [];
        const onAvailable = vi.fn();
        let failuresRemaining = 1;

        startImageAvailabilityPolling({
            src: '/assets/images/640/sample.jpg',
            intervalMs: 5000,
            createImage: () => {
                const image = {
                    onload: null,
                    onerror: null,
                    set src(value) {
                        attempts.push(value);
                        if (failuresRemaining > 0) {
                            failuresRemaining -= 1;
                            this.onerror?.(new Error('not-ready'));
                            return;
                        }

                        this.onload?.();
                    }
                };

                return image;
            },
            onAvailable
        });

        expect(attempts).toEqual([]);

        vi.advanceTimersByTime(5000);
        expect(attempts).toEqual(['/assets/images/640/sample.jpg?retry=1']);
        expect(onAvailable).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);
        expect(attempts).toEqual([
            '/assets/images/640/sample.jpg?retry=1',
            '/assets/images/640/sample.jpg?retry=2'
        ]);
        expect(onAvailable).toHaveBeenCalledWith(2);
    });

    it('stops polling when cancelled', () => {
        const attempts = [];

        const stopPolling = startImageAvailabilityPolling({
            src: '/assets/images/640/sample.jpg',
            intervalMs: 5000,
            createImage: () => ({
                onload: null,
                onerror: null,
                set src(value) {
                    attempts.push(value);
                    this.onerror?.(new Error('not-ready'));
                }
            }),
            onAvailable: vi.fn()
        });

        stopPolling();
        vi.advanceTimersByTime(15000);

        expect(attempts).toEqual([]);
    });

    it('stops retrying after the maximum wait time elapses', () => {
        const attempts = [];
        const onExhausted = vi.fn();

        startImageAvailabilityPolling({
            src: '/assets/images/640/sample.jpg',
            intervalMs: 5000,
            maxDurationMs: 100000,
            createImage: () => ({
                onload: null,
                onerror: null,
                set src(value) {
                    attempts.push(value);
                    this.onerror?.(new Error('not-ready'));
                }
            }),
            onAvailable: vi.fn(),
            onExhausted
        });

        vi.advanceTimersByTime(100000);

        expect(attempts).toHaveLength(20);
        expect(onExhausted).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(15000);

        expect(attempts).toHaveLength(20);
        expect(onExhausted).toHaveBeenCalledTimes(1);
    });
});
