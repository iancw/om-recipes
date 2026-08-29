import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const originalBaseUrl = process.env.APP_BASE_URL;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

// Pinned so the build-time `new Date()` fallback in the sitemap is deterministic.
const BUILD_TIME = new Date('2026-08-29T12:00:00.000Z');
const PORTRA_UPDATED = new Date('2026-07-01T09:30:00.000Z');

vi.mock('next/cache', () => {
    return {
        unstable_cache: (fn, keyParts = []) => async (...args) => {
            const key = JSON.stringify([keyParts, args]);
            if (!cacheState.entries.has(key)) cacheState.entries.set(key, fn(...args));
            return cacheState.entries.get(key);
        }
    };
});

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

describe('sitemap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(BUILD_TIME);
        cacheState.entries.clear();
        process.env.APP_BASE_URL = 'https://www.omrecipes.dev';

        selectMock = vi.fn(() => ({
            from: vi.fn(() =>
                Promise.resolve([
                    { slug: 'portra-400', updatedAt: PORTRA_UPDATED },
                    { slug: 'kodak-gold', updatedAt: null },
                    { slug: null, updatedAt: null }
                ])
            )
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('publishes slug-based recipe URLs only, with per-recipe crawl hints', async () => {
        const { default: sitemap } = await import('../app/sitemap.js');

        await expect(sitemap()).resolves.toEqual([
            { url: 'https://www.omrecipes.dev/', lastModified: BUILD_TIME, changeFrequency: 'daily', priority: 1 },
            { url: 'https://www.omrecipes.dev/about', lastModified: BUILD_TIME, changeFrequency: 'yearly', priority: 0.3 },
            { url: 'https://www.omrecipes.dev/how-to', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            { url: 'https://www.omrecipes.dev/how-to/how-recipes-work', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            { url: 'https://www.omrecipes.dev/how-to/manual-entry', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            { url: 'https://www.omrecipes.dev/how-to/custom-modes', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            { url: 'https://www.omrecipes.dev/how-to/om-workspace', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            { url: 'https://www.omrecipes.dev/how-to/camera-from-jpg', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.5 },
            // Recipe with a known updatedAt reports it; one without falls back to build time.
            { url: 'https://www.omrecipes.dev/recipes/portra-400', lastModified: PORTRA_UPDATED, changeFrequency: 'monthly', priority: 0.7 },
            { url: 'https://www.omrecipes.dev/recipes/kodak-gold', lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.7 }
        ]);
    });

    it('reuses cached recipe URL rows for repeat sitemap generation', async () => {
        const { default: sitemap } = await import('../app/sitemap.js');

        await sitemap();
        await sitemap();

        expect(selectMock).toHaveBeenCalledTimes(1);
    });
});

afterAll(() => {
    if (originalBaseUrl == null) {
        delete process.env.APP_BASE_URL;
        return;
    }

    process.env.APP_BASE_URL = originalBaseUrl;
});
