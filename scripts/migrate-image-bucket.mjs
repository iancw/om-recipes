import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import {
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv,
    headObject
} from '../lib/oci/objectStorage.js';
import { invokeImageResizeFunction } from '../lib/oci/functionsInvoke.js';
import { expectedVariantObjectNames } from './backfill-image-renditions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function usage() {
    return [
        'Usage:',
        '  node scripts/migrate-image-bucket.mjs --object-name <key> [--object-name <key> ...] [--dry-run]',
        '',
        'Options:',
        '  --object-name  Source object key to copy and resize; may be provided multiple times',
        '  --dry-run      Print intended work without invoking the function'
    ].join('\n');
}

function fail(message) {
    throw new Error(message);
}

export function parseArgs(argv) {
    const out = {
        objectNames: [],
        dryRun: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--object-name') {
            const objectName = String(argv[i + 1] ?? '').trim();
            if (!objectName) {
                fail(`Missing value for --object-name\n\n${usage()}`);
            }
            out.objectNames.push(objectName);
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

    if (out.objectNames.length === 0) {
        fail(`Provide at least one --object-name\n\n${usage()}`);
    }

    return out;
}

export function expectedMigrationObjectNames(objectKey) {
    const normalizedObjectKey = String(objectKey ?? '').trim().replace(/^\/+/, '');
    if (!normalizedObjectKey) {
        fail('expectedMigrationObjectNames requires a non-empty object key');
    }
    return [normalizedObjectKey, ...expectedVariantObjectNames(normalizedObjectKey)];
}

export async function migrateImageBucket({
    objectNames,
    dryRun,
    sourceBucket,
    destinationBucket,
    namespaceName,
    storageClient,
    invokeImageResizeFunction: invoke = invokeImageResizeFunction,
    headObject: head = headObject
}) {
    const normalizedObjectNames = objectNames.map((objectName) => String(objectName ?? '').trim()).filter(Boolean);
    if (normalizedObjectNames.length === 0) {
        fail('migrateImageBucket requires at least one object name');
    }

    if (dryRun) {
        return {
            processed: normalizedObjectNames.length,
            succeeded: normalizedObjectNames.length,
            failed: 0,
            verified: 0,
            dryRun: true
        };
    }

    const response = await invoke({
        sourceBucket,
        objectNames: normalizedObjectNames,
        destinationBucket
    });

    const results = Array.isArray(response?.results) ? response.results : [];
    let verified = 0;

    for (const result of results) {
        if (!result?.ok) {
            continue;
        }

        for (const objectName of expectedMigrationObjectNames(result.objectName)) {
            await head({
                client: storageClient,
                namespaceName,
                bucketName: destinationBucket,
                objectName
            });
            verified += 1;
        }
    }

    return {
        processed: response?.processed ?? normalizedObjectNames.length,
        succeeded: response?.succeeded ?? results.filter((result) => result?.ok).length,
        failed: response?.failed ?? results.filter((result) => result && result.ok === false).length,
        verified,
        dryRun: false
    };
}

export async function main() {
    dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });

    const { objectNames, dryRun } = parseArgs(process.argv.slice(2));
    const sourceBucket = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
    const destinationBucket = process.env.OCI_IMAGES_PROCESSED_BUCKET;

    if (!sourceBucket) fail('OCI_IMAGES_ORIGINAL_BUCKET is not set.');
    if (!destinationBucket) fail('OCI_IMAGES_PROCESSED_BUCKET is not set.');

    if (dryRun) {
        console.log(
            JSON.stringify(
                {
                    dryRun: true,
                    sourceBucket,
                    destinationBucket,
                    objectNames,
                    expectedObjects: objectNames.map((objectName) => expectedMigrationObjectNames(objectName))
                },
                null,
                2
            )
        );
        return;
    }

    const storageClient = getObjectStorageClientFromEnv();
    const namespaceName = getObjectStorageNamespaceFromEnv();

    const summary = await migrateImageBucket({
        objectNames,
        dryRun,
        sourceBucket,
        destinationBucket,
        namespaceName,
        storageClient
    });

    console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}
