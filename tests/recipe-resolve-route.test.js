import { beforeEach, describe, expect, it, vi } from 'vitest';

let resolveRecipeIndexEntryMock;

vi.mock('../lib/public-recipe-catalog.js', () => ({
    resolveRecipeIndexEntry: (...args) => resolveRecipeIndexEntryMock(...args)
}));

async function call(url) {
    const mod = await import('../app/recipes/resolve/route.js');
    return mod.GET(new Request(url));
}

describe('GET /recipes/resolve', () => {
    beforeEach(() => {
        vi.resetModules();
        resolveRecipeIndexEntryMock = vi.fn(async () => null);
    });

    it('400s when recipe is missing', async () => {
        const res = await call('https://x.test/recipes/resolve');
        expect(res.status).toBe(400);
        expect(resolveRecipeIndexEntryMock).not.toHaveBeenCalled();
    });

    it('returns the slug unchanged for a current slug', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async () => ({ id: 123, slug: 'ibd_glow' }));
        const res = await call('https://x.test/recipes/resolve?recipe=ibd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('resolves an old alias to the canonical slug', async () => {
        resolveRecipeIndexEntryMock = vi.fn(async (identifier) =>
            identifier === 'isaacbd_glow' ? { id: 123, slug: 'ibd_glow' } : null
        );
        const res = await call('https://x.test/recipes/resolve?recipe=isaacbd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('404s for an unknown identifier', async () => {
        const res = await call('https://x.test/recipes/resolve?recipe=nope');
        expect(res.status).toBe(404);
    });
});
