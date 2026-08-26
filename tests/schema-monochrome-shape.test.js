import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recipeColorSettings, recipeMonoSettings, recipes } from '../db/schema.ts';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(testDir, '../migrations/0020_curly_starbolt.sql');
const journalPath = path.resolve(testDir, '../migrations/meta/_journal.json');
const snapshotPath = path.resolve(testDir, '../migrations/meta/0020_snapshot.json');

describe('monochrome recipe schema shape', () => {
    it('defines a recipe type column and dedicated child settings tables', () => {
        expect(recipes.type.name).toBe('type');
        expect(recipeColorSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.monochromeColor.name).toBe('monochrome_color');
        expect(recipeMonoSettings.filmGrain.name).toBe('film_grain');
        expect(recipeMonoSettings.monochromeVignetting.name).toBe('monochrome_vignetting');
    });

    // The `recipes_settings_match_check` constraint trigger described in
    // openspec/changes/monochrome-profiles/design.md (a DB-level guarantee that every
    // recipe has exactly one matching settings row) is not built yet — see task 1.2 in
    // openspec/changes/monochrome-profiles/tasks.md. It can't land until the backfill
    // migration for pre-existing recipes runs, since they don't have child-table rows yet.
    it('tracks the child settings tables in drizzle metadata', () => {
        expect(existsSync(migrationPath)).toBe(true);
        expect(existsSync(snapshotPath)).toBe(true);

        const migrationSql = readFileSync(migrationPath, 'utf8');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        const migrationEntry = journal.entries.find((entry) => entry.tag === '0020_curly_starbolt');

        expect(migrationSql).toContain('CREATE TABLE "recipe_color_settings"');
        expect(migrationSql).toContain('CREATE TABLE "recipe_mono_settings"');
        expect(migrationSql).toContain('ALTER TABLE "recipes" ADD COLUMN "type"');
        expect(migrationEntry?.idx).toBe(20);
        expect(snapshot.version).toBeTruthy();
    });
});
