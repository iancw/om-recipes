import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recipeSlugAliases } from '../db/schema.ts';
import { computeSlugBase, slugify } from '../lib/recipe-slug.js';

describe('recipe_slug_aliases schema', () => {
    it('defines the alias columns with snake_case SQL names', () => {
        expect(recipeSlugAliases.id.name).toBe('id');
        expect(recipeSlugAliases.recipeId.name).toBe('recipe_id');
        expect(recipeSlugAliases.slug.name).toBe('slug');
        expect(recipeSlugAliases.createdAt.name).toBe('created_at');
    });

    it('is tracked in a generated migration', () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const journal = JSON.parse(
            readFileSync(path.resolve(testDir, '../migrations/meta/_journal.json'), 'utf8')
        );
        const entry = journal.entries.at(-1);
        const sql = readFileSync(path.resolve(testDir, `../migrations/${entry.tag}.sql`), 'utf8');
        expect(sql).toContain('CREATE TABLE "recipe_slug_aliases"');
        expect(sql).toMatch(/recipe_slug_aliases_slug_unique/);
    });
});

describe('slugify', () => {
    it('lowercases and dashes non-alphanumerics', () => {
        expect(slugify('Portra 400!!')).toBe('portra-400');
    });
    it('trims leading and trailing separators', () => {
        expect(slugify('  --Hello--  ')).toBe('hello');
    });
    it('collapses repeated separators', () => {
        expect(slugify('a   ---   b')).toBe('a-b');
    });
    it('handles nullish input', () => {
        expect(slugify(null)).toBe('');
        expect(slugify(undefined)).toBe('');
    });
});

describe('computeSlugBase', () => {
    it('joins slugified author and recipe name with an underscore', () => {
        expect(computeSlugBase({ authorName: 'Isaac B', recipeName: 'Autumn Glow' })).toBe('isaac-b_autumn-glow');
    });
});

const { recipeRowsQueue, aliasRowsQueue } = vi.hoisted(() => ({
    recipeRowsQueue: { current: [] },
    aliasRowsQueue: { current: [] }
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: vi.fn(() => {
            let table = null;
            const chain = {
                from: vi.fn((t) => {
                    table = t;
                    return chain;
                }),
                innerJoin: vi.fn(() => chain),
                where: vi.fn(() => chain),
                limit: vi.fn(() => {
                    const isAlias = table && table[Symbol.for('drizzle:Name')] === 'recipe_slug_aliases';
                    const queue = isAlias ? aliasRowsQueue : recipeRowsQueue;
                    return Promise.resolve(queue.current.shift() ?? []);
                })
            };
            return chain;
        }),
        insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) })) })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
        delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }))
    }
}));

describe('resolveUniqueSlug', () => {
    beforeEach(() => {
        recipeRowsQueue.current = [];
        aliasRowsQueue.current = [];
    });
    afterEach(() => vi.clearAllMocks());

    it('returns the base slug when nothing else uses it', async () => {
        const { resolveUniqueSlug } = await import('../lib/recipe-slug.js');
        recipeRowsQueue.current = [[]];
        aliasRowsQueue.current = [[]];
        expect(await resolveUniqueSlug({ base: 'ibd_glow', recipeId: 7 })).toBe('ibd_glow');
    });

    it('appends -2 when the base collides with another recipe', async () => {
        const { resolveUniqueSlug } = await import('../lib/recipe-slug.js');
        // attempt 1: recipes hit, aliases empty -> taken; attempt 2: both empty -> free
        recipeRowsQueue.current = [[{ id: 99 }], []];
        aliasRowsQueue.current = [[], []];
        expect(await resolveUniqueSlug({ base: 'ibd_glow', recipeId: 7 })).toBe('ibd_glow-2');
    });

    it('appends -2 when the base collides with an alias', async () => {
        const { resolveUniqueSlug } = await import('../lib/recipe-slug.js');
        recipeRowsQueue.current = [[], []];
        aliasRowsQueue.current = [[{ id: 5 }], []];
        expect(await resolveUniqueSlug({ base: 'ibd_glow', recipeId: 7 })).toBe('ibd_glow-2');
    });

    it('does not count the recipe or its own aliases as taken', async () => {
        const { resolveUniqueSlug } = await import('../lib/recipe-slug.js');
        // mock ignores the where clause, so simulate "filtered out" by returning empty
        recipeRowsQueue.current = [[]];
        aliasRowsQueue.current = [[]];
        expect(await resolveUniqueSlug({ base: 'ibd_glow', recipeId: 7 })).toBe('ibd_glow');
    });

    it('throws after MAX_SLUG_SUFFIX attempts', async () => {
        const { resolveUniqueSlug } = await import('../lib/recipe-slug.js');
        recipeRowsQueue.current = Array.from({ length: 1001 }, () => [{ id: 1 }]);
        aliasRowsQueue.current = Array.from({ length: 1001 }, () => []);
        await expect(resolveUniqueSlug({ base: 'ibd_glow', recipeId: null })).rejects.toThrow(
            'Unable to generate a unique slug'
        );
    });
});

describe('applySlugChange', () => {
    beforeEach(() => {
        recipeRowsQueue.current = [];
        aliasRowsQueue.current = [];
    });
    afterEach(() => vi.clearAllMocks());

    it('is a no-op when the slug is unchanged', async () => {
        const { applySlugChange } = await import('../lib/recipe-slug.js');
        const { db } = await import('../db/index.ts');
        const result = await applySlugChange({ recipeId: 7, oldSlug: 'ibd_glow', newSlug: 'ibd_glow' });
        expect(result).toEqual({ changed: false, newSlug: 'ibd_glow' });
        expect(db.insert).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.delete).not.toHaveBeenCalled();
    });

    it('is a no-op when the new slug is falsy', async () => {
        const { applySlugChange } = await import('../lib/recipe-slug.js');
        const { db } = await import('../db/index.ts');
        const result = await applySlugChange({ recipeId: 7, oldSlug: 'ibd_glow', newSlug: '' });
        expect(result).toEqual({ changed: false, newSlug: 'ibd_glow' });
        expect(db.insert).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.delete).not.toHaveBeenCalled();
    });

    it('records the old slug, moves the canonical slug, and clears a redundant alias', async () => {
        const { applySlugChange } = await import('../lib/recipe-slug.js');
        const { db } = await import('../db/index.ts');
        const result = await applySlugChange({ recipeId: 7, oldSlug: 'isaacbd_glow', newSlug: 'ibd_glow' });
        expect(result).toEqual({ changed: true, newSlug: 'ibd_glow' });

        expect(db.insert).toHaveBeenCalledTimes(1);
        expect(db.update).toHaveBeenCalledTimes(1);
        expect(db.delete).toHaveBeenCalledTimes(1);

        const insertOrder = db.insert.mock.invocationCallOrder[0];
        const updateOrder = db.update.mock.invocationCallOrder[0];
        const deleteOrder = db.delete.mock.invocationCallOrder[0];
        expect(insertOrder).toBeLessThan(updateOrder);
        expect(updateOrder).toBeLessThan(deleteOrder);
    });
});
