import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const originalBaseUrl = process.env.APP_BASE_URL;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

describe('sitemap', () => {
    beforeEach(() => {
        vi.resetModules();
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
});

afterAll(() => {
    if (originalBaseUrl == null) {
        delete process.env.APP_BASE_URL;
        return;
    }

    process.env.APP_BASE_URL = originalBaseUrl;
});
