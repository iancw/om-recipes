/**
 * Upload comparison images to object storage and link the resulting
 * object-backed image rows to a recipe.
 *
 * Usage:
 *   node scripts/upload-comparison-images.mjs --slug <recipe-slug> --dir <path/to/comparisons>
 *
 * The --dir path should point to a comparisons/ folder whose files are named
 * <label>.jpg (or .jpeg / .png / .webp). The label is derived from the filename
 * (without extension) and stored in recipe_comparison_images.label.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { neon } from '@netlify/neon';
import dotenv from 'dotenv';

import {
    buildManualImageObjectKey,
    findOrCreateObjectBackedImage,
    publishManualImageAsset
} from './manual-image-storage.mjs';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function parseArgs(argv) {
    const args = argv.slice(2);
    const result = {
        dryRun: false
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--slug' && args[i + 1]) result.slug = args[++i];
        else if (args[i] === '--dir' && args[i + 1]) result.dir = args[++i];
        else if (args[i] === '--dry-run') result.dryRun = true;
    }
    return result;
}

function labelFromFilename(filename) {
    return path.basename(filename, path.extname(filename));
}

export async function uploadComparisonImages({
    recipe,
    dirEntries,
    sql,
    dryRun = false,
    publishManualImageAsset: publish = publishManualImageAsset,
    findOrCreateObjectBackedImage: findOrCreate = findOrCreateObjectBackedImage
}) {
    const images = [];

    for (const entry of dirEntries) {
        const objectKey = buildManualImageObjectKey({
            authorUuid: recipe.author_uuid,
            recipeSlug: recipe.slug,
            fileName: entry.absolutePath,
            comparisonLabel: entry.label
        });

        if (!dryRun) {
            await publish({
                absolutePath: entry.absolutePath,
                objectKey,
                originalBucket: process.env.OCI_IMAGES_ORIGINAL_BUCKET,
                processedBucket: process.env.OCI_IMAGES_PROCESSED_BUCKET
            });
        }

        const { image } = await findOrCreate(sql, {
            authorId: recipe.author_id,
            objectKey,
            dryRun
        });

        if (!dryRun && image.id != null) {
            await sql`
                INSERT INTO recipe_comparison_images (recipe_id, image_id, label)
                VALUES (${recipe.id}, ${image.id}, ${entry.label})
                ON CONFLICT DO NOTHING
            `;
        }

        images.push({
            label: entry.label,
            objectKey,
            imageId: image.id
        });
    }

    return { images };
}

async function main() {
    const { slug, dir, dryRun } = parseArgs(process.argv);

    if (!slug || !dir) {
        console.error('Usage: node scripts/upload-comparison-images.mjs --slug <recipe-slug> --dir <path/to/comparisons>');
        process.exitCode = 1;
        return;
    }

    if (!process.env.NETLIFY_DATABASE_URL) {
        throw new Error('NETLIFY_DATABASE_URL is not set.');
    }

    const sql = neon(process.env.NETLIFY_DATABASE_URL);
    const absDir = path.resolve(dir);

    // Verify the directory exists
    try {
        await fs.access(absDir);
    } catch {
        throw new Error(`Directory not found: ${absDir}`);
    }

    // Look up recipe by slug
    const recipe = await sql`
        SELECT r.id, r.slug, r.author_id, a.uuid AS author_uuid
        FROM recipes r
        INNER JOIN authors a ON a.id = r.author_id
        WHERE r.slug = ${slug}
        LIMIT 1
    `;
    if (recipe.length === 0) {
        throw new Error(`No recipe found with slug: ${slug}`);
    }
    console.log(`Recipe: ${slug} (id=${recipe[0].id})`);

    // Scan the comparisons directory for image files
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const imageFiles = entries
        .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
        .map((e) => path.join(absDir, e.name))
        .sort();

    if (imageFiles.length === 0) {
        console.log('No image files found in directory.');
        return;
    }

    console.log(`Found ${imageFiles.length} image(s):`);

    const { images } = await uploadComparisonImages({
        recipe: recipe[0],
        dirEntries: imageFiles.map((filePath) => ({
            absolutePath: filePath,
            label: labelFromFilename(filePath)
        })),
        sql,
        dryRun
    });

    console.log(`\nDone. images_processed=${images.length}`);
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
