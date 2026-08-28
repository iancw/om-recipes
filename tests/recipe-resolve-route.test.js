import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;

const makeSelectChain = (result) => ({
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(result))
});

vi.mock('../db/index.ts', () => ({ db: { select: (...a) => selectMock(...a) } }));

async function call(url) {
    const mod = await import('../app/recipes/resolve/route.js');
    return mod.GET(new Request(url));
}

describe('GET /recipes/resolve', () => {
    beforeEach(() => vi.resetModules());

    it('400s when recipe is missing', async () => {
        selectMock = vi.fn(() => makeSelectChain([]));
        const res = await call('https://x.test/recipes/resolve');
        expect(res.status).toBe(400);
    });

    it('returns the slug unchanged for a current slug', async () => {
        selectMock = vi.fn(() => makeSelectChain([{ slug: 'ibd_glow' }]));
        const res = await call('https://x.test/recipes/resolve?recipe=ibd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('resolves an old alias to the canonical slug', async () => {
        // 1st select (direct) -> miss, 2nd select (alias join) -> hit
        const responses = [[], [{ slug: 'ibd_glow' }]];
        selectMock = vi.fn(() => makeSelectChain(responses.shift() ?? []));
        const res = await call('https://x.test/recipes/resolve?recipe=isaacbd_glow');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ canonical: 'ibd_glow' });
    });

    it('404s for an unknown identifier', async () => {
        selectMock = vi.fn(() => makeSelectChain([]));
        const res = await call('https://x.test/recipes/resolve?recipe=nope');
        expect(res.status).toBe(404);
    });
});
