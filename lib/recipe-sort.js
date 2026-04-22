export const RECIPE_SORT_VALUES = Object.freeze({
  SAVES: 'saves',
  NEWEST: 'newest',
  OLDEST: 'oldest'
});

export const DEFAULT_RECIPE_SORT = RECIPE_SORT_VALUES.SAVES;

export const RECIPE_SORT_OPTIONS = [
  { value: RECIPE_SORT_VALUES.SAVES, label: 'Saves' },
  { value: RECIPE_SORT_VALUES.NEWEST, label: 'Newest' },
  { value: RECIPE_SORT_VALUES.OLDEST, label: 'Oldest' }
];

const VALID_RECIPE_SORTS = new Set(RECIPE_SORT_OPTIONS.map((option) => option.value));

export function normalizeRecipeSort(value) {
  return VALID_RECIPE_SORTS.has(value) ? value : DEFAULT_RECIPE_SORT;
}
