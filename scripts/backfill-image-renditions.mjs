import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { neon } from '@netlify/neon';
import dotenv from 'dotenv';

import {
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv,
    headObject
} from '../lib/oci/objectStorage.js';
import { invokeImageResizeFunction } from '../lib/oci/functionsInvoke.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXPECTED_VARIANTS = ['320', '640', '960', '1200', '1600'];
const DEFAULT_BATCH_SIZE = 100;

function usage() {
    return [
        'Usage:',
        '  node scripts/backfill-image-renditions.mjs [--after-id <id>] [--limit <count>] [--dry-run]',
        '',
        'Options:',
        '  --after-id  Resume with rows strictly after this image id',
        '  --limit     Maximum number of rows to process in this run',
        '  --dry-run   Print intended work without invoking the function',
    ].join('\n');
}

function fail(message) {
    throw new Error(message);
}

function parsePositiveInt(rawValue, flagName, { allowZero = false } = {}) {
    const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
    const minimum = allowZero ? 0 : 1;
    if (!Number.isFinite(parsed) || parsed < minimum) {
        fail(`${flagName} must be an integer >= ${minimum}, got: ${rawValue}`);
    }
    return parsed;
}

export function parseArgs(argv) {
    const out = {
        afterId: 0,
        limit: null,
        dryRun: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--after-id') {
            out.afterId = parsePositiveInt(argv[i + 1], '--after-id', { allowZero: true });
            i += 1;
        } else if (arg === '--limit') {
            out.limit = parsePositiveInt(argv[i + 1], '--limit');
            i += 1;
        } else if (arg === '--dry-run') {
            out.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(usage());
            process.exit(0);
        } else {
            fail(`Unknown argument: ${arg}\n\n${usage()}`);
        }
    }

    return out;
}

export function expectedVariantObjectNames(objectKey) {
    const normalizedObjectKey = String(objectKey ?? '').trim().replace(/^\/+/, '');
    if (!normalizedObjectKey) {
        fail('expectedVariantObjectNames requires a non-empty object key');
    }
    return EXPECTED_VARIANTS.map((variant) => `${variant}/${normalizedObjectKey}`);
}

export async function backfillImageRenditions({
    rows,
    dryRun,
    originalBucket,
    resizedBucket,
    namespaceName,
    storageClient,
    invokeImageResizeFunction: invoke = invokeImageResizeFunction,
    headObject: head = headObject
}) {
    const summary = {
        processed: 0,
        verified: 0,
        lastProcessedId: null,
        dryRun: Boolean(dryRun)
    };

    for (const row of rows) {
        const imageId = Number.parseInt(String(row.id), 10);
        const objectKey = String(row.prepared_object_key ?? row.preparedObjectKey ?? '').trim();
        if (!Number.isFinite(imageId) || !objectKey) {
            fail(`Invalid backfill row: ${JSON.stringify(row)}`);
        }

        const variantObjectNames = expectedVariantObjectNames(objectKey);
        summary.processed += 1;
        summary.lastProcessedId = imageId;

        if (summary.dryRun) {
            continue;
        }

        await invoke({
            sourceBucket: originalBucket,
            objectName: objectKey,
            destinationBucket: resizedBucket
        });

        for (const objectName of variantObjectNames) {
            await head({
                client: storageClient,
                namespaceName,
                bucketName: resizedBucket,
                objectName
            });
            summary.verified += 1;
        }
    }

    return summary;
}

async function fetchImageBatch({ sql, afterId, limit }) {
    const batchSize = limit == null ? DEFAULT_BATCH_SIZE : Math.min(limit, DEFAULT_BATCH_SIZE);
    return sql`
        SELECT id, prepared_object_key
        FROM images
        WHERE finalized_at IS NOT NULL
          AND prepared_object_key IS NOT NULL
          AND id > ${afterId}
        ORDER BY id ASC
        LIMIT ${batchSize}
    `;
}

export async function main() {
    dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });

    const { afterId, limit, dryRun } = parseArgs(process.argv.slice(2));
    if (!process.env.NETLIFY_DATABASE_URL) {
        fail('NETLIFY_DATABASE_URL is not set.');
    }

    const originalBucket = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
    const resizedBucket = process.env.OCI_IMAGES_PROCESSED_BUCKET;

    if (!originalBucket) fail('OCI_IMAGES_ORIGINAL_BUCKET is not set.');
    if (!resizedBucket) fail('OCI_IMAGES_PROCESSED_BUCKET is not set.');

    const sql = neon(process.env.NETLIFY_DATABASE_URL);
    const storageClient = dryRun ? null : getObjectStorageClientFromEnv();
    const namespaceName = dryRun ? null : getObjectStorageNamespaceFromEnv();

    const summary = {
        processed: 0,
        verified: 0,
        lastProcessedId: afterId,
        dryRun
    };

    let cursor = afterId;
    let remaining = limit;

    while (true) {
        const rows = await fetchImageBatch({
            sql,
            afterId: cursor,
            limit: remaining
        });

        if (rows.length === 0) {
            break;
        }

        const batchSummary = await backfillImageRenditions({
            rows,
            dryRun,
            originalBucket,
            resizedBucket,
            namespaceName,
            storageClient
        });

        summary.processed += batchSummary.processed;
        summary.verified += batchSummary.verified;
        summary.lastProcessedId = batchSummary.lastProcessedId ?? summary.lastProcessedId;
        cursor = summary.lastProcessedId;

        if (remaining != null) {
            remaining -= batchSummary.processed;
            if (remaining <= 0) {
                break;
            }
        }
    }

    console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}
