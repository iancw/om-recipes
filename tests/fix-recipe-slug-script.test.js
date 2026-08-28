import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.ts', () => ({ db: {} }));

describe('fixRecipeSlug', () => {
    it('inserts the old slug as an alias, updates the recipe, and clears a redundant alias', async () => {
        const calls = [];
        const sql = vi.fn((strings, ...values) => {
            calls.push({ text: strings.join('?'), values });
            return Promise.resolve([]);
        });

        const { fixRecipeSlug } = await import('../scripts/fix-recipe-slug.mjs');
        const result = await fixRecipeSlug({
            recipe: { id: 42, slug: 'isaacbd-glow', author_name: 'ibd', recipe_name: 'Glow' },
            newSlug: 'ibd-glow',
            sql
        });

        expect(result).toEqual({ oldSlug: 'isaacbd-glow', newSlug: 'ibd-glow', aliasCreated: true });
        const writes = calls.slice(-3);
        expect(writes[0].text).toMatch(/insert into recipe_slug_aliases/i);
        expect(writes[1].text).toMatch(/update recipes/i);
        expect(writes[2].text).toMatch(/delete from recipe_slug_aliases/i);
    });

    it('throws when an explicit newSlug collides with another recipe or a historical alias', async () => {
        const sql = vi.fn((strings) => {
            const text = strings.join('?');
            if (/^\s*select/i.test(text)) return Promise.resolve([{ 1: 1 }]);
            return Promise.resolve([]);
        });

        const { fixRecipeSlug } = await import('../scripts/fix-recipe-slug.mjs');
        await expect(
            fixRecipeSlug({
                recipe: { id: 42, slug: 'isaacbd-glow', author_name: 'ibd', recipe_name: 'Glow' },
                newSlug: 'taken-slug',
                sql
            })
        ).rejects.toThrow(/already used by another recipe or is a historical alias/i);

        expect(sql.mock.calls.every(([strings]) => /^\s*select/i.test(strings.join('?')))).toBe(true);
    });

    it('is a no-op when the new slug equals the current slug', async () => {
        const sql = vi.fn(() => Promise.resolve([]));
        const { fixRecipeSlug } = await import('../scripts/fix-recipe-slug.mjs');
        const result = await fixRecipeSlug({
            recipe: { id: 42, slug: 'ibd-glow', author_name: 'ibd', recipe_name: 'Glow' },
            newSlug: 'ibd-glow',
            sql
        });
        expect(result).toEqual({ oldSlug: 'ibd-glow', newSlug: 'ibd-glow', aliasCreated: false });
        expect(sql).not.toHaveBeenCalled();
    });
});
