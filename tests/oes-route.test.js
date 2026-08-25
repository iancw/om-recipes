import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let makeOESXmlMock;

const makeSelectChain = (result) => ({
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
});

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('../lib/oes.js', () => ({
    makeOESXml: (...args) => makeOESXmlMock(...args)
}));

describe('OES download route', () => {
    beforeEach(() => {
        vi.resetModules();
        makeOESXmlMock = vi.fn(() => '<xml />');
    });

    it('builds OES XML for monochrome recipes', async () => {
        selectMock = vi.fn(() =>
            makeSelectChain([
                {
                    slug: 'mono-recipe',
                    type: 'MONO',
                    colorSettings: {},
                    monoSettings: {
                        monochromeProfile: 'MONOTONE',
                        monochromeColor: 'Yellow Filter',
                        monochromeColorStrength: 2,
                        filmGrain: 'Low',
                        filmHue: 'Sepia'
                    }
                }
            ])
        );

        const mod = await import('../app/oes/[slug]/route.js');
        const response = await mod.GET(new Request('https://example.com/oes/mono-recipe.oes'), {
            params: Promise.resolve({ slug: 'mono-recipe.oes' })
        });

        expect(response.status).toBe(200);
        expect(makeOESXmlMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'MONO',
                monochromeColor: 'Yellow Filter',
                monochromeColorStrength: 2,
                filmGrain: 'Low',
                filmHue: 'Sepia',
                supportsOesDownload: true
            })
        );
        await expect(response.text()).resolves.toBe('<xml />');
    });

    it('builds OES XML for color recipes', async () => {
        selectMock = vi.fn(() =>
            makeSelectChain([
                {
                    slug: 'color-recipe',
                    type: 'COLOR',
                    colorSettings: {
                        yellow: 1,
                        contrast: -1,
                        whiteBalanceAmberOffset: 2,
                        whiteBalanceGreenOffset: -1
                    },
                    monoSettings: {}
                }
            ])
        );

        const mod = await import('../app/oes/[slug]/route.js');
        const response = await mod.GET(new Request('https://example.com/oes/color-recipe.oes'), {
            params: Promise.resolve({ slug: 'color-recipe.oes' })
        });

        expect(response.status).toBe(200);
        expect(makeOESXmlMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'COLOR',
                yellow: 1,
                contrast: -1,
                supportsOesDownload: true
            })
        );
        await expect(response.text()).resolves.toBe('<xml />');
    });
});
