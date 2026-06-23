import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recipeColorSettings, recipeMonoSettings, recipes } from '../db/schema.ts';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(testDir, '../migrations/0018_monochrome_profiles.sql');
const journalPath = path.resolve(testDir, '../migrations/meta/_journal.json');
const snapshotPath = path.resolve(testDir, '../migrations/meta/0018_snapshot.json');

describe('monochrome recipe schema shape', () => {
    it('defines a recipe type column and dedicated child settings tables', () => {
        expect(recipes.type.name).toBe('type');
        expect(recipeColorSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.monochromeColor.name).toBe('monochrome_color');
        expect(recipeMonoSettings.filmGrain.name).toBe('film_grain');
        expect(recipeMonoSettings.monochromeVignetting.name).toBe('monochrome_vignetting');
    });

    it('tracks the migration in drizzle metadata', () => {
        expect(existsSync(migrationPath)).toBe(true);
        expect(existsSync(snapshotPath)).toBe(true);

        const migrationSql = readFileSync(migrationPath, 'utf8');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        const migrationEntry = journal.entries.find((entry) => entry.tag === '0018_monochrome_profiles');

        expect(migrationSql).toContain('CREATE CONSTRAINT TRIGGER "recipes_settings_match_check"');
        expect(migrationSql).toContain("IF TG_OP = 'DELETE' THEN");
        expect(migrationSql).toContain('PERFORM "public"."enforce_recipe_settings_match"(OLD."recipe_id");');
        expect(migrationSql).toContain('PERFORM "public"."enforce_recipe_settings_match"(NEW."recipe_id");');
        expect(migrationEntry?.idx).toBe(19);
        expect(snapshot.version).toBeTruthy();
    });
});
