import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { neon } from '@netlify/neon';
import dotenv from 'dotenv';

import { buildManualImageObjectKey, publishManualImageAsset as defaultPublishManualImageAsset } from './manual-image-storage.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function decodeLegacyPublicImagePath(imageUrl, repoRoot) {
    const raw = String(imageUrl ?? '').trim();
    if (!raw || !raw.startsWith('/images/')) {
        throw new Error(`Expected a legacy repo-backed /images/ URL, got: ${raw || '<empty>'}`);
    }

    const relative = raw.replace(/^\/+/, '');
    const decodedSegments = relative.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));

    if (decodedSegments[0] !== 'images') {
        throw new Error(`Expected a legacy repo-backed /images/ URL, got: ${raw}`);
    }

    if (
        decodedSegments.some((segment) =>
            segment === '.' ||
            segment === '..' ||
            segment.includes('\0') ||
            segment.includes('/') ||
            segment.includes('\\')
        )
    ) {
        throw new Error(`Refusing traversal or malformed legacy image path: ${raw}`);
    }

    const resolved = path.resolve(repoRoot, 'public', ...decodedSegments);
    const publicImagesRoot = path.resolve(repoRoot, 'public', 'images');
    const relativeToImagesRoot = path.relative(publicImagesRoot, resolved);

    if (relativeToImagesRoot.startsWith('..') || path.isAbsolute(relativeToImagesRoot)) {
        throw new Error(`Refusing traversal or malformed legacy image path: ${raw}`);
    }

    return resolved;
}

function findLegacyImageUrl(image) {
    return [
        image.fullSizeUrl,
        image.full_size_url,
        image.smallUrl,
        image.small_url
    ].find((url) => String(url ?? '').trim().startsWith('/images/'));
}

export function buildMigrationPlanRow({ image, recipe, comparisonLabel, repoRoot }) {
    const legacyUrl = findLegacyImageUrl(image);
    const absolutePath = decodeLegacyPublicImagePath(legacyUrl, repoRoot);
    const objectKey = buildManualImageObjectKey({
        authorUuid: recipe.authorUuid ?? recipe.author_uuid,
        recipeSlug: recipe.slug,
        fileName: absolutePath,
        comparisonLabel
    });

    return {
        imageId: image.id,
        absolutePath,
        objectKey
    };
}

export async function defaultUpdatePreparedObjectKey(sql, { imageId, objectKey }) {
    await sql`
        UPDATE images
        SET prepared_object_key = ${objectKey}
        WHERE id = ${imageId}
          AND prepared_object_key IS NULL
    `;
}

export function parseArgs(argv) {
    const args = {
        dryRun: false
    };

    for (const arg of argv) {
        if (arg === '--dry-run') {
            args.dryRun = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return args;
}

function dedupeAssociations(rows) {
    const grouped = new Map();

    for (const row of rows) {
        const imageId = row.image_id;
        const comparisonLabel = row.comparison_label ?? null;
        const key = JSON.stringify([
            row.recipe_id,
            row.recipe_slug,
            row.author_uuid,
            comparisonLabel
        ]);

        if (!grouped.has(imageId)) {
            grouped.set(imageId, new Map());
        }

        grouped.get(imageId).set(key, {
            recipeId: row.recipe_id,
            recipeSlug: row.recipe_slug,
            authorUuid: row.author_uuid,
            comparisonLabel
        });
    }

    return grouped;
}

function formatAssociation(association) {
    if (association.comparisonLabel) {
        return `${association.recipeSlug} (${association.comparisonLabel})`;
    }

    return association.recipeSlug;
}

function selectAssociationForImage({ imageId, comparisonAssociations, sampleAssociations }) {
    if (comparisonAssociations.length > 1) {
        throw new Error(
            `Ambiguous comparison associations for image_id ${imageId}: ${comparisonAssociations.map(formatAssociation).join(', ')}`
        );
    }

    if (comparisonAssociations.length === 1) {
        return comparisonAssociations[0];
    }

    if (sampleAssociations.length > 1) {
        throw new Error(
            `Ambiguous sample associations for image_id ${imageId}: ${sampleAssociations.map(formatAssociation).join(', ')}`
        );
    }

    if (sampleAssociations.length === 1) {
        return sampleAssociations[0];
    }

    throw new Error(`Missing recipe association for legacy repo image_id ${imageId}`);
}

export async function fetchLegacyRepoImageRows(sql, { warn = console.warn } = {}) {
    const images = await sql`
        SELECT
            i.id AS image_id,
            i.full_size_url,
            i.small_url,
            i.prepared_object_key
        FROM images i
        WHERE i.prepared_object_key IS NULL
          AND (
              i.full_size_url LIKE '/images/%'
              OR i.small_url LIKE '/images/%'
          )
        ORDER BY i.id ASC
    `;

    if (images.length === 0) {
        return [];
    }

    const imageIds = images.map((row) => row.image_id);
    const comparisonAssociations = await sql`
        SELECT
            rci.image_id,
            r.id AS recipe_id,
            r.slug AS recipe_slug,
            a.uuid AS author_uuid,
            rci.label AS comparison_label
        FROM recipe_comparison_images rci
        INNER JOIN recipes r ON r.id = rci.recipe_id
        INNER JOIN authors a ON a.id = r.author_id
        WHERE rci.image_id = ANY(${imageIds})
        ORDER BY rci.image_id ASC, rci.label ASC
    `;

    const sampleAssociations = await sql`
        SELECT
            rsi.image_id,
            r.id AS recipe_id,
            r.slug AS recipe_slug,
            a.uuid AS author_uuid
        FROM recipe_sample_images rsi
        INNER JOIN recipes r ON r.id = rsi.recipe_id
        INNER JOIN authors a ON a.id = r.author_id
        WHERE rsi.image_id = ANY(${imageIds})
        ORDER BY rsi.image_id ASC
    `;

    const comparisonByImageId = dedupeAssociations(comparisonAssociations);
    const sampleByImageId = dedupeAssociations(sampleAssociations);

    const selectedRows = [];

    for (const row of images) {
        try {
            const association = selectAssociationForImage({
                imageId: row.image_id,
                comparisonAssociations: [...(comparisonByImageId.get(row.image_id)?.values() ?? [])],
                sampleAssociations: [...(sampleByImageId.get(row.image_id)?.values() ?? [])]
            });

            selectedRows.push({
                image: {
                    id: row.image_id,
                    fullSizeUrl: row.full_size_url,
                    smallUrl: row.small_url,
                    preparedObjectKey: row.prepared_object_key
                },
                recipe: {
                    id: association.recipeId,
                    slug: association.recipeSlug,
                    authorUuid: association.authorUuid
                },
                comparisonLabel: association.comparisonLabel
            });
        } catch (error) {
            if (error instanceof Error) {
                warn(error.message);
                continue;
            }

            throw error;
        }
    }

    return selectedRows;
}

export async function migrateLegacyRepoImages({
    rows,
    repoRoot,
    sql,
    dryRun = false,
    publishManualImageAsset: publish = defaultPublishManualImageAsset,
    updatePreparedObjectKey = defaultUpdatePreparedObjectKey
}) {
    const summary = {
        processed: 0,
        migrated: 0,
        skipped: 0
    };

    for (const row of rows) {
        summary.processed += 1;

        const preparedObjectKey = row.image.preparedObjectKey ?? row.image.prepared_object_key;
        if (preparedObjectKey) {
            summary.skipped += 1;
            continue;
        }

        const planRow = buildMigrationPlanRow({
            image: row.image,
            recipe: row.recipe,
            comparisonLabel: row.comparisonLabel ?? null,
            repoRoot
        });

        if (!dryRun) {
            console.log(`Migrating ${planRow.imageId} - ${planRow.absolutePath} -> ${planRow.objectKey}`)
            await publish({
                absolutePath: planRow.absolutePath,
                objectKey: planRow.objectKey,
                originalBucket: process.env.OCI_IMAGES_ORIGINAL_BUCKET,
                processedBucket: process.env.OCI_IMAGES_PROCESSED_BUCKET
            });

            console.log(`Updating DB for ${planRow.imageId} with object key ${planRow.objectKey}`)
            await updatePreparedObjectKey(sql, {
                imageId: planRow.imageId,
                objectKey: planRow.objectKey
            });
        } else {
            console.log(JSON.stringify({
                imageId: planRow.imageId,
                absolutePath: planRow.absolutePath,
                objectKey: planRow.objectKey,
                originalBucket: process.env.OCI_IMAGES_ORIGINAL_BUCKET,
                processedBucket: process.env.OCI_IMAGES_PROCESSED_BUCKET
            }))
        }

        summary.migrated += 1;
    }

    return summary;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/migrate-legacy-repo-images.mjs [--dry-run]',
        '',
        'Migrates legacy repo-backed /images/... sample and comparison images to object storage.'
    ].join('\n');
}

export async function main({
    argv = process.argv.slice(2),
    env = process.env,
    cwd = process.cwd(),
    repoRoot = REPO_ROOT,
    createSql = neon,
    fetchLegacyRepoImageRows: fetchRows = fetchLegacyRepoImageRows,
    migrateLegacyRepoImages: migrate = migrateLegacyRepoImages,
    loadEnv = dotenv.config,
    log = console.log
} = {}) {
    loadEnv({ path: path.join(cwd, '.env.local') });

    const { dryRun, help } = parseArgs(argv);
    if (help) {
        log(usage());
        return null;
    }

    if (!env.NETLIFY_DATABASE_URL) {
        throw new Error('NETLIFY_DATABASE_URL is not set.');
    }

    const sql = createSql(env.NETLIFY_DATABASE_URL);
    const rows = await fetchRows(sql);
    const migrationSummary = await migrate({
        rows,
        repoRoot,
        sql,
        dryRun
    });
    const summary = {
        ...migrationSummary,
        candidates: rows.length,
        dryRun
    };

    log(JSON.stringify(summary, null, 2));

    return summary;
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}
