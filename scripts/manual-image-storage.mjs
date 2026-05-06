import path from 'node:path';

import { expectedVariantObjectNames } from './backfill-image-renditions.mjs';
import {
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv,
    headObject,
    putObjectFromFile
} from '../lib/oci/objectStorage.js';
import { invokeImageResizeFunction } from '../lib/oci/functionsInvoke.js';

function sanitizeSegment(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'image';
}

function normalizeExtension(fileName) {
    const ext = path.extname(String(fileName ?? '')).toLowerCase();
    if (ext === '.jpeg') return '.jpg';
    return ['.jpg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
}

function contentTypeFromPath(filePath) {
    switch (path.extname(String(filePath ?? '')).toLowerCase()) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
}

export function buildManualImageObjectKey({ authorUuid, recipeSlug, fileName, comparisonLabel }) {
    const ext = normalizeExtension(fileName);
    const baseName = sanitizeSegment(comparisonLabel || path.basename(fileName, path.extname(fileName)));
    const basePath = `authors/${authorUuid}/recipes/${recipeSlug}`;

    return comparisonLabel
        ? `${basePath}/comparisons/${baseName}${ext}`
        : `${basePath}/${baseName}${ext}`;
}

export function expectedImageObjects(objectKey) {
    return [objectKey].concat(expectedVariantObjectNames(objectKey));
}

export async function publishManualImageAsset({
    absolutePath,
    objectKey,
    originalBucket,
    processedBucket,
    namespaceName = getObjectStorageNamespaceFromEnv(),
    storageClient = getObjectStorageClientFromEnv(),
    putObjectFromFile: put = putObjectFromFile,
    invokeImageResizeFunction: invoke = invokeImageResizeFunction,
    headObject: head = headObject
}) {
    const expectedObjects = expectedImageObjects(objectKey);

    console.log(`putting image`)
    await put({
        client: storageClient,
        namespaceName,
        bucketName: originalBucket,
        objectName: objectKey,
        filePath: absolutePath,
        contentType: contentTypeFromPath(absolutePath)
    });

    console.log(`invoking ... `)
    await invoke({
        sourceBucket: originalBucket,
        objectName: objectKey,
        destinationBucket: processedBucket
    });

    for (const name of expectedObjects) {
        await head({
            client: storageClient,
            namespaceName,
            bucketName: name === objectKey ? originalBucket : processedBucket,
            objectName: name
        });
    }

    return { objectKey, verifiedObjects: expectedObjects.length };
}

export async function findOrCreateObjectBackedImage(sql, { authorId, objectKey, dryRun }) {
    const existing = await sql`
        SELECT id, prepared_object_key, author_id
        FROM images
        WHERE prepared_object_key = ${objectKey}
        LIMIT 1
    `;

    if (existing.length > 0) {
        return { image: existing[0], created: false };
    }

    if (dryRun) {
        return {
            image: { id: null, prepared_object_key: objectKey, author_id: authorId },
            created: true
        };
    }

    const created = await sql`
        INSERT INTO images (author_id, prepared_object_key, full_size_url, small_url, valid_exif)
        VALUES (${authorId}, ${objectKey}, null, null, false)
        ON CONFLICT DO NOTHING
        RETURNING id, prepared_object_key, author_id
    `;

    if (created.length > 0) {
        return { image: created[0], created: true };
    }

    const conflicted = await sql`
        SELECT id, prepared_object_key, author_id
        FROM images
        WHERE prepared_object_key = ${objectKey}
        LIMIT 1
    `;

    if (conflicted.length > 0) {
        return { image: conflicted[0], created: false };
    }

    throw new Error(`Failed to create or find image for prepared_object_key: ${objectKey}`);
}
