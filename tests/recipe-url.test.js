import { describe, expect, it, vi } from 'vitest';

import {
    buildRecipeSearchParams,
    fetchCanonicalRecipeIdentifier,
    findRecipeIndexByIdentifier,
    getRecipePath,
    getRecipeSelectionFromSearchParams,
    isUuidLike,
    recipeMatchesIdentifier
} from '../lib/recipe-url.js';

describe('recipe-url helpers', () => {
    it('uses the slug as the canonical recipe path', () => {
        expect(getRecipePath({ slug: 'portra-400', uuid: 'recipe-uuid' })).toBe('/recipes/portra-400');
    });

    it('matches recipes by either slug or uuid', () => {
        const recipe = { slug: 'portra-400', uuid: '123e4567-e89b-12d3-a456-426614174000' };

        expect(recipeMatchesIdentifier(recipe, 'portra-400')).toBe(true);
        expect(recipeMatchesIdentifier(recipe, '123e4567-e89b-12d3-a456-426614174000')).toBe(true);
        expect(recipeMatchesIdentifier(recipe, 'other')).toBe(false);
    });

    it('finds a recipe from legacy uuid deep links', () => {
        const recipes = [
            { slug: 'recipe-a', uuid: '11111111-1111-1111-1111-111111111111' },
            { slug: 'recipe-b', uuid: '22222222-2222-2222-2222-222222222222' }
        ];

        expect(findRecipeIndexByIdentifier(recipes, '22222222-2222-2222-2222-222222222222')).toBe(1);
        expect(findRecipeIndexByIdentifier(recipes, 'recipe-a')).toBe(0);
    });

    it('parses canonical and legacy homepage recipe query keys', () => {
        expect(getRecipeSelectionFromSearchParams('?recipe=portra-400')).toEqual({
            key: 'recipe',
            value: 'portra-400'
        });
        expect(getRecipeSelectionFromSearchParams('?id=123e4567-e89b-12d3-a456-426614174000')).toEqual({
            key: 'id',
            value: '123e4567-e89b-12d3-a456-426614174000'
        });
        expect(getRecipeSelectionFromSearchParams('?uuid=123e4567-e89b-12d3-a456-426614174000')).toEqual({
            key: 'uuid',
            value: '123e4567-e89b-12d3-a456-426614174000'
        });
        expect(getRecipeSelectionFromSearchParams('?slug=portra-400')).toEqual({
            key: 'slug',
            value: 'portra-400'
        });
    });

    it('normalizes homepage recipe params to the canonical recipe key and preserves unrelated params', () => {
        const nextParams = buildRecipeSearchParams('?id=123e4567-e89b-12d3-a456-426614174000&sort=popular', {
            slug: 'portra-400',
            uuid: '123e4567-e89b-12d3-a456-426614174000'
        });

        expect(nextParams.toString()).toBe('sort=popular&recipe=portra-400');
    });

    it('detects uuid-like identifiers', () => {
        expect(isUuidLike('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
        expect(isUuidLike('portra-400')).toBe(false);
    });
});

describe('fetchCanonicalRecipeIdentifier', () => {
    it('returns the canonical slug from the resolver', async () => {
        const fetchImpl = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({ canonical: 'ibd_glow' }) })
        );
        expect(await fetchCanonicalRecipeIdentifier('isaacbd_glow', { fetchImpl })).toBe('ibd_glow');
        expect(fetchImpl).toHaveBeenCalledWith('/recipes/resolve?recipe=isaacbd_glow');
    });

    it('returns null on a 404', async () => {
        const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
        expect(await fetchCanonicalRecipeIdentifier('nope', { fetchImpl })).toBeNull();
    });

    it('returns null when fetch throws', async () => {
        const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
        expect(await fetchCanonicalRecipeIdentifier('x', { fetchImpl })).toBeNull();
    });

    it('returns null for a blank identifier without calling fetch', async () => {
        const fetchImpl = vi.fn();
        expect(await fetchCanonicalRecipeIdentifier('  ', { fetchImpl })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
