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
const PUBLIC_IMAGES_DIR = path.join(REPO_ROOT, 'public', 'images');

function usage() {
    return [
        'Usage:',
        '  node scripts/link-public-sample-image.mjs --recipe <id|slug|uuid> --image <path-relative-to-repo-root>',
        '',
        'Examples:',
        '  node scripts/link-public-sample-image.mjs --recipe portra-400 --image "public/images/Ian Will/Portra 400/lighthouse.jpg"',
        '  node scripts/link-public-sample-image.mjs --recipe 42 --image "public/images/OM System/Default - 1/lighthouse.jpg"'
    ].join('\n');
}

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    const out = {
        recipe: '',
        image: '',
        dryRun: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--recipe') {
            out.recipe = String(argv[i + 1] ?? '').trim();
            i++;
            continue;
        }
        if (arg === '--image') {
            out.image = String(argv[i + 1] ?? '').trim();
            i++;
            continue;
        }
        if (arg === '--dry-run') {
            out.dryRun = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            console.log(usage());
            process.exit(0);
        }
        fail(`Unknown argument: ${arg}\n\n${usage()}`);
    }

    if (!out.recipe || !out.image) {
        fail(`Missing required arguments.\n\n${usage()}`);
    }

    return out;
}

function toPublicImageUrl(relativeImagePath) {
    return `/images/${relativeImagePath.split('/').map(encodeURIComponent).join('/')}`;
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveImagePath(imageArg) {
    const candidate = path.resolve(REPO_ROOT, imageArg);

    const relative = path.relative(PUBLIC_IMAGES_DIR, candidate);
    if (
        !relative ||
        relative.startsWith('..') ||
        path.isAbsolute(relative)
    ) {
        fail(`Image path must be inside ${PUBLIC_IMAGES_DIR}`);
    }

    if (!(await pathExists(candidate))) {
        fail(`Image file not found: ${candidate}`);
    }

    return {
        absolutePath: candidate,
        relativePath: relative.split(path.sep).join('/'),
        publicUrl: toPublicImageUrl(relative.split(path.sep).join('/'))
    };
}

async function findRecipe(sql, recipeIdentifier) {
    const recipeId = Number.parseInt(recipeIdentifier, 10);
    const rows = Number.isFinite(recipeId) && String(recipeId) === recipeIdentifier
        ? await sql`
            SELECT
                r.id,
                r.uuid,
                r.slug,
                r.recipe_name,
                r.author_id,
                a.name AS author_name,
                a.uuid AS author_uuid
            FROM recipes r
            INNER JOIN authors a ON a.id = r.author_id
            WHERE r.id = ${recipeId}
               OR r.slug = ${recipeIdentifier}
               OR r.uuid::text = ${recipeIdentifier}
            ORDER BY CASE
                WHEN r.id = ${recipeId} THEN 0
                WHEN r.slug = ${recipeIdentifier} THEN 1
                ELSE 2
            END
            LIMIT 2
        `
        : await sql`
            SELECT
                r.id,
                r.uuid,
                r.slug,
                r.recipe_name,
                r.author_id,
                a.name AS author_name,
                a.uuid AS author_uuid
            FROM recipes r
            INNER JOIN authors a ON a.id = r.author_id
            WHERE r.slug = ${recipeIdentifier}
               OR r.uuid::text = ${recipeIdentifier}
            ORDER BY CASE
                WHEN r.slug = ${recipeIdentifier} THEN 0
                ELSE 1
            END
            LIMIT 2
        `;

    if (rows.length === 0) {
        fail(`Recipe not found for identifier: ${recipeIdentifier}`);
    }
    if (rows.length > 1) {
        fail(`Recipe identifier is ambiguous: ${recipeIdentifier}. Use an exact numeric id or UUID.`);
    }

    return rows[0];
}

async function ensureRecipeSampleLink(sql, { recipeId, imageId, authorId, dryRun }) {
    const existing = (await sql`
        SELECT recipe_id, image_id, author_id
        FROM recipe_sample_images
        WHERE recipe_id = ${recipeId}
          AND image_id = ${imageId}
        LIMIT 1
    `) ?? [];

    if (Array.isArray(existing) && existing.length > 0) {
        if (existing[0].author_id !== authorId && !dryRun) {
            await sql`
                UPDATE recipe_sample_images
                SET author_id = ${authorId}
                WHERE recipe_id = ${recipeId}
                  AND image_id = ${imageId}
            `;
            return { created: false, updatedAuthor: true };
        }

        return { created: false, updatedAuthor: false };
    }

    if (dryRun) {
        return { created: true, updatedAuthor: false };
    }

    await sql`
        INSERT INTO recipe_sample_images (recipe_id, image_id, author_id)
        VALUES (${recipeId}, ${imageId}, ${authorId})
    `;

    return { created: true, updatedAuthor: false };
}

export async function linkPublicSampleImage({
    recipe,
    imagePath,
    sql,
    dryRun = false,
    publishManualImageAsset: publish = publishManualImageAsset,
    findOrCreateObjectBackedImage: findOrCreate = findOrCreateObjectBackedImage
}) {
    const objectKey = buildManualImageObjectKey({
        authorUuid: recipe.author_uuid,
        recipeSlug: recipe.slug,
        fileName: imagePath.absolutePath,
        comparisonLabel: null
    });

    if (!dryRun) {
        await publish({
            absolutePath: imagePath.absolutePath,
            objectKey,
            originalBucket: process.env.OCI_IMAGES_ORIGINAL_BUCKET,
            processedBucket: process.env.OCI_IMAGES_PROCESSED_BUCKET
        });
    }

    const { image, created } = await findOrCreate(sql, {
        authorId: recipe.author_id,
        objectKey,
        dryRun
    });

    if (image.id != null) {
        await ensureRecipeSampleLink(sql, {
            recipeId: recipe.id,
            imageId: image.id,
            authorId: recipe.author_id,
            dryRun
        });
    }

    return {
        imageCreated: created,
        imageRow: {
            id: image.id,
            preparedObjectKey: objectKey
        }
    };
}

async function main() {
    const { recipe: recipeIdentifier, image: imageArg, dryRun } = parseArgs(process.argv.slice(2));

    if (!process.env.NETLIFY_DATABASE_URL) {
        fail('NETLIFY_DATABASE_URL is not set.');
    }

    const imagePath = await resolveImagePath(imageArg);
    const sql = neon(process.env.NETLIFY_DATABASE_URL);
    const recipe = await findRecipe(sql, recipeIdentifier);
    const result = await linkPublicSampleImage({
        recipe,
        imagePath,
        sql,
        dryRun
    });

    console.log(JSON.stringify({
        ok: true,
        dryRun,
        recipe: {
            id: recipe.id,
            uuid: recipe.uuid,
            slug: recipe.slug,
            recipeName: recipe.recipe_name,
            authorId: recipe.author_id,
            authorName: recipe.author_name
        },
        imageFile: {
            absolutePath: imagePath.absolutePath,
            relativePath: imagePath.relativePath,
            publicUrl: imagePath.publicUrl
        },
        imageRow: result.imageRow,
        imageCreated: result.imageCreated
    }, null, 2));
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}
