import { db } from '../../db/index.ts';
import { images, recipeComparisonImages, recipeSampleImages } from '../../db/schema.ts';
import { inArray } from 'drizzle-orm';
import { getRecipeImageObjectKey, RECIPE_IMAGE_RENDITIONS } from '../recipe-image-assets.js';
import {
    deleteObject,
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv
} from './objectStorage.js';

const ORIGINAL_BUCKET = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
const PROCESSED_BUCKET = process.env.OCI_IMAGES_PROCESSED_BUCKET;
const PROCESSED_RENDITIONS = RECIPE_IMAGE_RENDITIONS.filter((variant) => variant !== 'original');

function deleteDuplicateIds(values) {
    return Array.from(new Set(values.filter((value) => value != null)));
}

async function deleteImageRowsAndObjects(imageIds) {
    const targetIds = deleteDuplicateIds(imageIds);
    if (targetIds.length === 0) return [];

    const targetImages = await db
        .select({
            id: images.id,
            preparedObjectKey: images.preparedObjectKey,
            fullSizeUrl: images.fullSizeUrl,
            smallUrl: images.smallUrl
        })
        .from(images)
        .where(inArray(images.id, targetIds));

    try {
        const namespaceName = getObjectStorageNamespaceFromEnv();
        const client = getObjectStorageClientFromEnv();

        for (const img of targetImages) {
            const objectKey = String(img.preparedObjectKey ?? '').trim() || getRecipeImageObjectKey(img);

            if (!objectKey) continue;

            await deleteObject({ client, namespaceName, bucketName: ORIGINAL_BUCKET, objectName: objectKey });

            for (const variant of PROCESSED_RENDITIONS) {
                await deleteObject({
                    client,
                    namespaceName,
                    bucketName: PROCESSED_BUCKET,
                    objectName: `${variant}/${objectKey}`
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
