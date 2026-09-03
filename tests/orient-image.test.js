import { describe, it, expect } from 'vitest';

import { canvasOrientationOps } from '../lib/orient-image.js';

describe('canvasOrientationOps', () => {
    it('is the identity transform for upright (orientation 1)', () => {
        expect(canvasOrientationOps(1, 160, 120)).toEqual({
            canvasWidth: 160,
            canvasHeight: 120,
            matrix: [1, 0, 0, 1, 0, 0]
        });
    });

    it('swaps canvas width/height for the 90°/270° rotations (5-8)', () => {
        for (const orientation of [5, 6, 7, 8]) {
            const ops = canvasOrientationOps(orientation, 160, 120);
            expect(ops.canvasWidth).toBe(120);
            expect(ops.canvasHeight).toBe(160);
        }
    });

    it('keeps canvas width/height for flips and 180° (2-4)', () => {
        for (const orientation of [2, 3, 4]) {
            const ops = canvasOrientationOps(orientation, 160, 120);
            expect(ops.canvasWidth).toBe(160);
            expect(ops.canvasHeight).toBe(120);
        }
    });

    it('uses the canonical EXIF transform matrices', () => {
        const w = 160;
        const h = 120;
        expect(canvasOrientationOps(6, w, h).matrix).toEqual([0, 1, -1, 0, h, 0]);
        expect(canvasOrientationOps(8, w, h).matrix).toEqual([0, -1, 1, 0, 0, w]);
        expect(canvasOrientationOps(3, w, h).matrix).toEqual([-1, 0, 0, -1, w, h]);
        expect(canvasOrientationOps(2, w, h).matrix).toEqual([-1, 0, 0, 1, w, 0]);
    });

    it('falls back to identity for out-of-range or missing orientation', () => {
        expect(canvasOrientationOps(0, 160, 120).matrix).toEqual([1, 0, 0, 1, 0, 0]);
        expect(canvasOrientationOps(99, 160, 120).matrix).toEqual([1, 0, 0, 1, 0, 0]);
        expect(canvasOrientationOps(undefined, 160, 120)).toEqual({
            canvasWidth: 160,
            canvasHeight: 120,
            matrix: [1, 0, 0, 1, 0, 0]
        });
    });
});
