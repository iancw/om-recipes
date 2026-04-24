import { db } from '../../db/index.ts';
import { images, recipeComparisonImages, recipeSampleImages } from '../../db/schema.ts';
import { inArray } from 'drizzle-orm';
import {
    deleteObject,
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv
} from './objectStorage.js';

const ORIGINAL_BUCKET = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
const PROCESSED_BUCKET = process.env.OCI_IMAGES_PROCESSED_BUCKET;

function objectKeyFromAssetsUrl(url) {
    const s = String(url ?? '');
    const m = s.match(/^\/assets\/images\/(?:original|1200|600)\/(.+)$/);
    return m ? m[1] : null;
}

function deleteDuplicateIds(values) {
    return Array.from(new Set(values.filter((value) => value != null)));
}

async function deleteImageRowsAndObjects(imageIds) {
    const targetIds = deleteDuplicateIds(imageIds);
    if (targetIds.length === 0) return [];

    const targetImages = await db
        .select({ id: images.id, fullSizeUrl: images.fullSizeUrl, smallUrl: images.smallUrl })
        .from(images)
        .where(inArray(images.id, targetIds));

    try {
        const namespaceName = getObjectStorageNamespaceFromEnv();
        const client = getObjectStorageClientFromEnv();

        for (const img of targetImages) {
            const fullKey = objectKeyFromAssetsUrl(img.fullSizeUrl);
            const resizedBaseKey = objectKeyFromAssetsUrl(img.smallUrl) || fullKey;

            if (fullKey) {
                await deleteObject({ client, namespaceName, bucketName: ORIGINAL_BUCKET, objectName: fullKey });
            }

            if (resizedBaseKey) {
                await deleteObject({
                    client,
                    namespaceName,
                    bucketName: PROCESSED_BUCKET,
                    objectName: `600/${resizedBaseKey}`
                });
                await deleteObject({
                    client,
                    namespaceName,
                    bucketName: PROCESSED_BUCKET,
                    objectName: `1200/${resizedBaseKey}`
                });
            }
        }
    } catch (e) {
        console.warn('Skipping OCI object deletion (missing env or OCI error):', e?.message || e);
    }

    await db.delete(images).where(inArray(images.id, targetIds));
    return targetIds;
}

export async function deleteImagesByIds(imageIds) {
    const targetIds = deleteDuplicateIds(imageIds);
    return deleteImageRowsAndObjects(targetIds);
}

export async function deleteOrphanedImagesByIds(imageIds) {
    const candidateIds = deleteDuplicateIds(imageIds);
    if (candidateIds.length === 0) return [];

    const [stillSample, stillComparison] = await Promise.all([
        db
            .select({ imageId: recipeSampleImages.imageId })
            .from(recipeSampleImages)
            .where(inArray(recipeSampleImages.imageId, candidateIds)),
        db
            .select({ imageId: recipeComparisonImages.imageId })
            .from(recipeComparisonImages)
            .where(inArray(recipeComparisonImages.imageId, candidateIds))
    ]);

    const stillReferenced = new Set(
        [...stillSample, ...stillComparison]
            .map((row) => row.imageId)
            .filter((value) => value != null)
    );

    const orphanedImageIds = candidateIds.filter((id) => !stillReferenced.has(id));
    if (orphanedImageIds.length === 0) return [];

    return deleteImageRowsAndObjects(orphanedImageIds);
}
