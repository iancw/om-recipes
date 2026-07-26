import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const originalBaseUrl = process.env.APP_BASE_URL;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

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
        cacheState.entries.clear();
        process.env.APP_BASE_URL = 'https://www.omrecipes.dev';

        selectMock = vi.fn(() => ({
            from: vi.fn(() =>
                Promise.resolve([
                    { slug: 'portra-400' },
                    { slug: 'kodak-gold' },
                    { slug: null }
                ])
            )
        }));
    });

    it('publishes slug-based recipe URLs only', async () => {
        const { default: sitemap } = await import('../app/sitemap.js');

        await expect(sitemap()).resolves.toEqual([
            { url: 'https://www.omrecipes.dev/' },
            { url: 'https://www.omrecipes.dev/about' },
            { url: 'https://www.omrecipes.dev/how-to' },
            { url: 'https://www.omrecipes.dev/recipes/portra-400' },
            { url: 'https://www.omrecipes.dev/recipes/kodak-gold' }
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
