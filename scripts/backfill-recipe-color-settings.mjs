import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';

import {
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeNoWbFingerprint,
    computeRecipeFingerprint
} from '../lib/recipeFingerprint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const LEGACY_COLOR_FIELDS = [
    'yellow', 'orange', 'orangeRed', 'red', 'magenta', 'violet', 'blue', 'blueCyan',
    'cyan', 'greenCyan', 'green', 'yellowGreen', 'contrast', 'sharpness', 'highlights',
    'shadows', 'midtones', 'shadingEffect', 'exposureCompensation', 'whiteBalance2',
    'whiteBalanceTemperature', 'whiteBalanceAmberOffset', 'whiteBalanceGreenOffset'
];

function fail(message) {
    throw new Error(message);
}

export function parseArgs(argv) {
    if (argv.length === 0) return { dryRun: false };
    if (argv.length === 1 && argv[0] === '--dry-run') return { dryRun: true };
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        return { help: true };
    }
    fail('Usage: node scripts/backfill-recipe-color-settings.mjs [--dry-run]');
}

export function buildColorSettingsBackfillValues(recipe) {
    const settings = { recipeType: 'COLOR' };
    for (const field of LEGACY_COLOR_FIELDS) {
        settings[field] = recipe[field];
    }

    return {
        recipeId: recipe.id,
        ...Object.fromEntries(LEGACY_COLOR_FIELDS.map((field) => [field, settings[field]])),
        recipeFingerprint: computeRecipeFingerprint(settings),
        colorFingerprint: computeColorFingerprint(settings),
        colorToneFingerprint: computeColorToneFingerprint(settings),
        noWbFingerprint: computeNoWbFingerprint(settings)
    };
}

export async function backfillRecipeColorSettings({
    database,
    recipeTable,
    colorSettingsTable,
    dryRun = false
} = {}) {
    if (!database || !recipeTable || !colorSettingsTable) {
        const [{ db: defaultDatabase }, schema] = await Promise.all([
            import('../db/index.ts'),
            import('../db/schema.ts')
        ]);
        database ??= defaultDatabase;
        recipeTable ??= schema.recipes;
        colorSettingsTable ??= schema.recipeColorSettings;
    }

    const fields = Object.fromEntries([
        ['id', recipeTable.id],
        ...LEGACY_COLOR_FIELDS.map((field) => [field, recipeTable[field]])
    ]);
    const legacyRecipes = await database
        .select(fields)
        .from(recipeTable)
        .leftJoin(colorSettingsTable, eq(colorSettingsTable.recipeId, recipeTable.id))
        .where(and(eq(recipeTable.type, 'COLOR'), isNull(colorSettingsTable.id)));

    const summary = {
        candidates: legacyRecipes.length,
        inserted: 0,
        dryRun
    };

    for (const recipe of legacyRecipes) {
        if (dryRun) continue;

        // The unique recipe_id constraint and conflict handler make reruns safe,
        // including if another process backfills a row after the initial query.
        const insertedRows = await database
            .insert(colorSettingsTable)
            .values(buildColorSettingsBackfillValues(recipe))
            .onConflictDoNothing()
            .returning({ recipeId: colorSettingsTable.recipeId });
        summary.inserted += insertedRows.length;
    }

    return summary;
}

export async function main() {
    dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });
    const { dryRun, help } = parseArgs(process.argv.slice(2));
    if (help) {
        console.log('Usage: node scripts/backfill-recipe-color-settings.mjs [--dry-run]');
        return;
    }
    if (!process.env.NETLIFY_DATABASE_URL) {
        fail('NETLIFY_DATABASE_URL is not set.');
    }

    const summary = await backfillRecipeColorSettings({ dryRun });
    console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}
