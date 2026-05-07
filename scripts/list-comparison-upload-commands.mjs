/**
 * Scans public/images for folders with a comparisons/ subdirectory, looks up
 * each recipe's slug in the database by author_name + recipe_name, and prints
 * the object-storage-backed comparison upload commands to run.
 *
 * Usage:
 *   node scripts/list-comparison-upload-commands.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { neon } from '@netlify/neon';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLIC_IMAGES_DIR = path.join(REPO_ROOT, 'public', 'images');

async function main() {
    if (!process.env.NETLIFY_DATABASE_URL) {
        throw new Error('NETLIFY_DATABASE_URL is not set.');
    }

    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // Find all comparisons/ directories (public/images/<author>/<recipe>/comparisons)
    const authorEntries = await fs.readdir(PUBLIC_IMAGES_DIR, { withFileTypes: true });
    const comparisonDirs = [];

    for (const authorEntry of authorEntries) {
        if (!authorEntry.isDirectory()) continue;
        const authorDir = path.join(PUBLIC_IMAGES_DIR, authorEntry.name);
        const recipeEntries = await fs.readdir(authorDir, { withFileTypes: true });

        for (const recipeEntry of recipeEntries) {
            if (!recipeEntry.isDirectory()) continue;
            const comparisonsDir = path.join(authorDir, recipeEntry.name, 'comparisons');
            try {
                await fs.access(comparisonsDir);
                comparisonDirs.push({
                    authorName: authorEntry.name,
                    recipeName: recipeEntry.name,
                    dir: comparisonsDir
                });
            } catch {
                // no comparisons/ folder, skip
            }
        }
    }

    if (comparisonDirs.length === 0) {
        console.log('No comparisons directories found.');
        return;
    }

    const notFound = [];

    for (const { authorName, recipeName, dir } of comparisonDirs) {
        const rows = await sql`
            SELECT slug FROM recipes
            WHERE author_name = ${authorName} AND recipe_name = ${recipeName}
            LIMIT 1
        `;

        if (rows.length === 0) {
            notFound.push(`${authorName} / ${recipeName}`);
            console.error(`# NOT FOUND in DB: author="${authorName}" recipe="${recipeName}"`);
            continue;
        }

        const slug = rows[0].slug;
        const relDir = path.relative(REPO_ROOT, dir);
        console.log(`node scripts/upload-comparison-images.mjs --slug ${slug} --dir "${relDir}"`);
    }

    if (notFound.length > 0) {
        console.error(`\n# ${notFound.length} recipe(s) not found in database.`);
    }
}

export { main as listComparisonUploadCommands };

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
