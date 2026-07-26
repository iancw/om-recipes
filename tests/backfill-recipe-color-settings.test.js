import { describe, expect, it } from 'vitest';

import {
    buildColorSettingsBackfillValues,
    parseArgs
} from '../scripts/backfill-recipe-color-settings.mjs';
import {
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeNoWbFingerprint,
    computeRecipeFingerprint
} from '../lib/recipeFingerprint.js';

const LEGACY_RECIPE = {
    id: 42,
    yellow: 1,
    orange: 2,
    orangeRed: 3,
    red: 4,
    magenta: 5,
    violet: 6,
    blue: 7,
    blueCyan: 8,
    cyan: 9,
    greenCyan: 10,
    green: 11,
    yellowGreen: 12,
    contrast: -1,
    sharpness: 2,
    highlights: -2,
    shadows: 3,
    midtones: 0,
    shadingEffect: 4,
    exposureCompensation: -1,
    whiteBalance2: 'Custom WB 1',
    whiteBalanceTemperature: 5600,
    whiteBalanceAmberOffset: 2,
    whiteBalanceGreenOffset: -1
};

describe('backfill-recipe-color-settings', () => {
    it('copies legacy color settings and computes the child-table fingerprints', () => {
        const result = buildColorSettingsBackfillValues(LEGACY_RECIPE);
        const settings = { ...LEGACY_RECIPE, recipeType: 'COLOR' };
        const { id, ...legacySettings } = LEGACY_RECIPE;

        expect(result).toMatchObject({
            ...legacySettings,
            recipeId: id,
            recipeFingerprint: computeRecipeFingerprint(settings),
            colorFingerprint: computeColorFingerprint(settings),
            colorToneFingerprint: computeColorToneFingerprint(settings),
            noWbFingerprint: computeNoWbFingerprint(settings)
        });
        expect(result).not.toHaveProperty('id');
    });

    it('supports an explicit dry run', () => {
        expect(parseArgs([])).toEqual({ dryRun: false });
        expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
    });
});
