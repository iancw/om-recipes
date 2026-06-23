import { describe, expect, it } from 'vitest';

import {
    normalizeRecipeRow,
    normalizeRecipeTypeFilter,
    RECIPE_TYPE_FILTER_VALUES
} from '../lib/recipe-data.js';

describe('recipe-data normalization', () => {
    it('normalizes recipe type filters and defaults to ALL', () => {
        expect(normalizeRecipeTypeFilter(RECIPE_TYPE_FILTER_VALUES.ALL)).toBe(RECIPE_TYPE_FILTER_VALUES.ALL);
        expect(normalizeRecipeTypeFilter('color')).toBe(RECIPE_TYPE_FILTER_VALUES.COLOR);
        expect(normalizeRecipeTypeFilter('MONO')).toBe(RECIPE_TYPE_FILTER_VALUES.MONO);
        expect(normalizeRecipeTypeFilter('invalid')).toBe(RECIPE_TYPE_FILTER_VALUES.ALL);
    });

    it('prefers typed color child settings for color recipes', () => {
        const normalized = normalizeRecipeRow({
            id: 1,
            type: 'COLOR',
            yellow: -2,
            contrast: -1,
            whiteBalance2: 'Auto',
            colorSettings: {
                yellow: 3,
                contrast: 2,
                whiteBalance2: 'Custom WB 1'
            },
            monoSettings: {
                monochromeColor: 'Red Filter'
            }
        });

        expect(normalized.type).toBe('COLOR');
        expect(normalized.yellow).toBe(3);
        expect(normalized.contrast).toBe(2);
        expect(normalized.whiteBalance2).toBe('Custom WB 1');
        expect(normalized.monochromeColor).toBeNull();
        expect(normalized.colorSettings).toBeUndefined();
        expect(normalized.monoSettings).toBeUndefined();
    });

    it('prefers typed monochrome child settings for monochrome recipes', () => {
        const normalized = normalizeRecipeRow({
            id: 2,
            type: 'MONO',
            yellow: 4,
            contrast: -1,
            whiteBalance2: 'Auto',
            monoSettings: {
                monochromeProfile: 'Monochrome Profile 2',
                monochromeColor: 'Red Filter',
                monochromeColorStrength: 3,
                filmGrain: 'Strong',
                filmHue: 'Warm',
                monochromeVignetting: 'High',
                contrast: 1,
                whiteBalance2: 'Custom WB 2'
            }
        });

        expect(normalized.type).toBe('MONO');
        expect(normalized.yellow).toBeNull();
        expect(normalized.monochromeProfile).toBe('Monochrome Profile 2');
        expect(normalized.monochromeColor).toBe('Red Filter');
        expect(normalized.monochromeColorStrength).toBe(3);
        expect(normalized.filmGrain).toBe('Strong');
        expect(normalized.filmHue).toBe('Warm');
        expect(normalized.monochromeVignetting).toBe('High');
        expect(normalized.contrast).toBe(1);
        expect(normalized.whiteBalance2).toBe('Custom WB 2');
    });
});
