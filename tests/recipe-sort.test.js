import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RECIPE_SORT,
  normalizeRecipeSort,
  RECIPE_SORT_VALUES
} from '../lib/recipe-sort.js';

describe('normalizeRecipeSort', () => {
  it('keeps supported sort values', () => {
    expect(normalizeRecipeSort(RECIPE_SORT_VALUES.SAVES)).toBe(RECIPE_SORT_VALUES.SAVES);
    expect(normalizeRecipeSort(RECIPE_SORT_VALUES.NEWEST)).toBe(RECIPE_SORT_VALUES.NEWEST);
    expect(normalizeRecipeSort(RECIPE_SORT_VALUES.OLDEST)).toBe(RECIPE_SORT_VALUES.OLDEST);
    expect(normalizeRecipeSort(RECIPE_SORT_VALUES.AUTHOR)).toBe(RECIPE_SORT_VALUES.AUTHOR);
    expect(normalizeRecipeSort(RECIPE_SORT_VALUES.RECIPE_NAME)).toBe(RECIPE_SORT_VALUES.RECIPE_NAME);
  });

  it('falls back to the default sort for unsupported values', () => {
    expect(normalizeRecipeSort('popular')).toBe(DEFAULT_RECIPE_SORT);
    expect(normalizeRecipeSort(null)).toBe(DEFAULT_RECIPE_SORT);
    expect(normalizeRecipeSort(undefined)).toBe(DEFAULT_RECIPE_SORT);
  });
});
