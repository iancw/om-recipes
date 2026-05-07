import { Buffer } from 'node:buffer';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
    and,
    desc,
    eq,
    inArray,
    isNotNull,
    isNull,
    lt,
    or
} from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
    authMagicLinks,
    authSessions,
    authors,
    images,
    modeSlotAssignments,
    privacyRequests,
    recipeComparisonImages,
    recipeSampleImages,
    recipes,
    savedRecipes,
    users
} from '../db/schema.ts';
import { createZipArchive } from './zip.js';
import { buildPrivacyArtifactKey, deletePrivacyArtifact, getPrivacyArtifact, putPrivacyArtifact } from './privacy-artifacts.js';
import { getPrivacyRetentionConfig } from './privacy-retention.js';
import {
    deleteObject,
    getMissingObjectStorageEnvVars,
    getObject,
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv
} from './oci/objectStorage.js';
import { deleteImagesByIds } from './oci/deleteOrphanedImages.js';

const ORIGINAL_BUCKET = process.env.OCI_IMAGES_ORIGINAL_BUCKET;

export const PRIVACY_REQUEST_TYPE_EXPORT = 'export';
export const PRIVACY_REQUEST_TYPE_DELETE_ACCOUNT = 'delete_account';

export const PRIVACY_REQUEST_STATUS_PENDING = 'pending';
export const PRIVACY_REQUEST_STATUS_PROCESSING = 'processing';
export const PRIVACY_REQUEST_STATUS_COMPLETED = 'completed';
export const PRIVACY_REQUEST_STATUS_FAILED = 'failed';

function requestExistsMessage(requestType) {
    return requestType === PRIVACY_REQUEST_TYPE_EXPORT
        ? 'A data export is already in progress.'
        : 'An account deletion request is already in progress.';
}

function safeFailureSummary(error) {
    const message = String(error?.message ?? error ?? 'Request failed').trim();
    return message.slice(0, 400) || 'Request failed';
}

function downloadFileNameForUser(userUuid, now = new Date()) {
    const date = now.toISOString().slice(0, 10);
    return `om-recipes-export-${userUuid}-${date}.zip`;
}

async function streamToBuffer(streamOrReadableStream) {
    if (!streamOrReadableStream) return Buffer.alloc(0);

    const nodeStream =
        typeof streamOrReadableStream.getReader === 'function'
            ? Readable.fromWeb(streamOrReadableStream)
            : streamOrReadableStream;

    const chunks = [];
    for await (const chunk of nodeStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

async function getInFlightPrivacyRequest(userId, requestType) {
    const rows = await db
        .select({
            id: privacyRequests.id,
            requestType: privacyRequests.requestType,
            status: privacyRequests.status
        })
        .from(privacyRequests)
        .where(
            and(
                eq(privacyRequests.userId, userId),
                eq(privacyRequests.requestType, requestType),
                inArray(privacyRequests.status, [PRIVACY_REQUEST_STATUS_PENDING, PRIVACY_REQUEST_STATUS_PROCESSING])
            )
        )
        .limit(1);

    return rows[0] ?? null;
}

async function createPrivacyRequest({ userId, userUuid, requestType }) {
    const existing = await getInFlightPrivacyRequest(userId, requestType);
    if (existing) {
        throw new Error(requestExistsMessage(requestType));
    }

    const created = await db
        .insert(privacyRequests)
        .values({
            userId,
            subjectUserUuid: userUuid,
            requestType,
            status: PRIVACY_REQUEST_STATUS_PENDING
        })
        .returning({
            id: privacyRequests.id,
            userId: privacyRequests.userId,
            subjectUserUuid: privacyRequests.subjectUserUuid,
            requestType: privacyRequests.requestType
        });

    return created[0];
}

async function updatePrivacyRequest(requestId, values) {
    await db
        .update(privacyRequests)
        .set({
            ...values,
            updatedAt: new Date()
        })
        .where(eq(privacyRequests.id, requestId));
}

async function collectUserExportPayload(userId) {
    const userRows = await db
        .select({
            id: users.id,
            uuid: users.uuid,
            email: users.email,
            emailVerifiedAt: users.emailVerifiedAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (userRows.length === 0) {
        throw new Error('User not found');
    }

    const authorRows = await db
        .select({
            id: authors.id,
            uuid: authors.uuid,
            name: authors.name,
            instagramLink: authors.instagramLink,
            flickrLink: authors.flickrLink,
            website: authors.website,
            kofiLink: authors.kofiLink,
            createdAt: authors.createdAt,
            updatedAt: authors.updatedAt
        })
        .from(authors)
        .where(eq(authors.userId, userId))
        .orderBy(desc(authors.id));

    const authorIds = authorRows.map((row) => row.id);

    const [recipeRows, imageRows] = await Promise.all([
        authorIds.length === 0
            ? []
            : db
                  .select()
                  .from(recipes)
                  .where(inArray(recipes.authorId, authorIds))
                  .orderBy(desc(recipes.updatedAt)),
        authorIds.length === 0
            ? []
            : db
                  .select()
                  .from(images)
                  .where(inArray(images.authorId, authorIds))
                  .orderBy(desc(images.createdAt))
    ]);

    const imageIds = imageRows.map((row) => row.id);

    const [sampleRows, comparisonRows, savedRows, modeAssignmentRows] = await Promise.all([
        imageIds.length === 0
            ? []
            : db
                  .select({
                      imageId: recipeSampleImages.imageId,
                      recipeId: recipes.id,
                      recipeSlug: recipes.slug,
                      recipeName: recipes.recipeName
                  })
                  .from(recipeSampleImages)
                  .innerJoin(recipes, eq(recipes.id, recipeSampleImages.recipeId))
                  .where(inArray(recipeSampleImages.imageId, imageIds)),
        imageIds.length === 0
            ? []
            : db
                  .select({
                      imageId: recipeComparisonImages.imageId,
                      recipeId: recipes.id,
                      recipeSlug: recipes.slug,
                      recipeName: recipes.recipeName,
                      label: recipeComparisonImages.label
                  })
                  .from(recipeComparisonImages)
                  .innerJoin(recipes, eq(recipes.id, recipeComparisonImages.recipeId))
                  .where(inArray(recipeComparisonImages.imageId, imageIds)),
        db
            .select({
                recipeId: recipes.id,
                recipeSlug: recipes.slug,
                recipeName: recipes.recipeName,
                authorName: recipes.authorName,
                savedAt: savedRecipes.createdAt
            })
            .from(savedRecipes)
            .innerJoin(recipes, eq(recipes.id, savedRecipes.recipeId))
            .where(eq(savedRecipes.userId, userId))
            .orderBy(desc(savedRecipes.createdAt)),
        db
            .select({
                modePosition: modeSlotAssignments.modePosition,
                colorSlot: modeSlotAssignments.colorSlot,
                recipeId: recipes.id,
                recipeSlug: recipes.slug,
                recipeName: recipes.recipeName
            })
            .from(modeSlotAssignments)
            .leftJoin(recipes, eq(recipes.id, modeSlotAssignments.recipeId))
            .where(eq(modeSlotAssignments.userId, userId))
    ]);

    return {
        exportedAt: new Date().toISOString(),
        user: userRows[0],
        authors: authorRows,
        authoredRecipes: recipeRows,
        savedRecipes: savedRows,
        modeSlotAssignments: modeAssignmentRows,
        uploadedImages: imageRows,
        uploadedImageSampleAssociations: sampleRows,
        uploadedImageComparisonAssociations: comparisonRows
    };
}

async function collectOriginalUploadEntries(imageRows) {
    if (!imageRows.length) {
        return { entries: [], missingOriginalUploads: [] };
    }

    const missingEnvVars = getMissingObjectStorageEnvVars();
    if (missingEnvVars.length > 0 || !ORIGINAL_BUCKET) {
        return {
            entries: [],
            missingOriginalUploads: imageRows.map((image) => ({
                imageId: image.id,
                reason: 'Object storage is not configured in this environment'
            }))
        };
    }

    const namespaceName = getObjectStorageNamespaceFromEnv();
    const client = getObjectStorageClientFromEnv();

    const entries = [];
    const missingOriginalUploads = [];

    for (const image of imageRows) {
        const objectKey = String(image.preparedObjectKey ?? '').trim();
        if (!objectKey) {
            missingOriginalUploads.push({
                imageId: image.id,
                reason: 'No original object key is recorded for this upload'
            });
            continue;
        }

        try {
            const response = await getObject({
                client,
                namespaceName,
                bucketName: ORIGINAL_BUCKET,
                objectName: objectKey
            });
            const buffer = await streamToBuffer(response.value);
            const ext = path.extname(objectKey) || '.jpg';
            entries.push({
                name: `uploads/${image.uuid}${ext}`,
                data: buffer
            });
        } catch (error) {
            missingOriginalUploads.push({
                imageId: image.id,
                objectKey,
                reason: String(error?.message ?? error)
            });
        }
    }

    return {
        entries,
        missingOriginalUploads
    };
}

async function buildPrivacyExportArchive({ userId, userUuid }) {
    const payload = await collectUserExportPayload(userId);
    const { entries: uploadEntries, missingOriginalUploads } = await collectOriginalUploadEntries(payload.uploadedImages);

    const accountBuffer = Buffer.from(
        JSON.stringify(
            {
                ...payload,
                missingOriginalUploads
            },
            null,
            2
        )
    );

    const archive = createZipArchive([
        {
            name: 'account.json',
            data: accountBuffer
        },
        ...uploadEntries
    ]);

    return {
        buffer: archive,
        contentType: 'application/zip',
        fileName: downloadFileNameForUser(userUuid)
    };
}

async function eraseAccountData(userId) {
    const authorRows = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, userId));
    const authorIds = authorRows.map((row) => row.id);

    const ownedImageRows =
        authorIds.length === 0
            ? []
            : await db
                  .select({ id: images.id })
                  .from(images)
                  .where(inArray(images.authorId, authorIds));
    const ownedImageIds = ownedImageRows.map((row) => row.id);

    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    await db.delete(authMagicLinks).where(eq(authMagicLinks.userId, userId));

    if (ownedImageIds.length > 0) {
        await deleteImagesByIds(ownedImageIds);
    }

    if (authorIds.length > 0) {
        await db.delete(recipes).where(inArray(recipes.authorId, authorIds));
        await db.delete(authors).where(inArray(authors.id, authorIds));
    }

    await db.delete(users).where(eq(users.id, userId));
}

export async function listPrivacyRequestsForUser(userId, limit = 6) {
    return db
        .select({
            id: privacyRequests.id,
            requestType: privacyRequests.requestType,
            status: privacyRequests.status,
            artifactFileName: privacyRequests.artifactFileName,
            artifactSizeBytes: privacyRequests.artifactSizeBytes,
            artifactExpiresAt: privacyRequests.artifactExpiresAt,
            failureSummary: privacyRequests.failureSummary,
            createdAt: privacyRequests.createdAt,
            completedAt: privacyRequests.completedAt
        })
        .from(privacyRequests)
        .where(eq(privacyRequests.userId, userId))
        .orderBy(desc(privacyRequests.createdAt))
        .limit(limit);
}

export async function startPrivacyExport({ userId, userUuid }) {
    const request = await createPrivacyRequest({
        userId,
        userUuid,
        requestType: PRIVACY_REQUEST_TYPE_EXPORT
    });

    let artifactKey = null;

    try {
        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_PROCESSING,
            failureSummary: null
        });

        const artifact = await buildPrivacyExportArchive({ userId, userUuid });
        const config = getPrivacyRetentionConfig();
        const expiresAt = new Date(Date.now() + config.exportArtifactRetentionMs);
        artifactKey = buildPrivacyArtifactKey({ userUuid, requestId: request.id });

        await putPrivacyArtifact({
            key: artifactKey,
            buffer: artifact.buffer,
            contentType: artifact.contentType
        });

        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_COMPLETED,
            artifactKey,
            artifactContentType: artifact.contentType,
            artifactFileName: artifact.fileName,
            artifactSizeBytes: artifact.buffer.length,
            artifactExpiresAt: expiresAt,
            completedAt: new Date(),
            failureSummary: null
        });

        return request.id;
    } catch (error) {
        if (artifactKey) {
            await deletePrivacyArtifact({ key: artifactKey }).catch(() => {});
        }

        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_FAILED,
            artifactKey: null,
            artifactContentType: null,
            artifactFileName: null,
            artifactSizeBytes: null,
            artifactExpiresAt: null,
            failureSummary: safeFailureSummary(error),
            completedAt: new Date()
        });

        throw error;
    }
}

export async function startAccountDeletion({ userId, userUuid }) {
    const request = await createPrivacyRequest({
        userId,
        userUuid,
        requestType: PRIVACY_REQUEST_TYPE_DELETE_ACCOUNT
    });

    try {
        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_PROCESSING,
            failureSummary: null
        });

        await eraseAccountData(userId);

        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_COMPLETED,
            completedAt: new Date(),
            failureSummary: null
        });

        return request.id;
    } catch (error) {
        await updatePrivacyRequest(request.id, {
            status: PRIVACY_REQUEST_STATUS_FAILED,
            completedAt: new Date(),
            failureSummary: safeFailureSummary(error)
        });
        throw error;
    }
}

export async function getDownloadablePrivacyExport({ requestId, userId, now = new Date() }) {
    const rows = await db
        .select({
            id: privacyRequests.id,
            requestType: privacyRequests.requestType,
            status: privacyRequests.status,
            artifactKey: privacyRequests.artifactKey,
            artifactContentType: privacyRequests.artifactContentType,
            artifactFileName: privacyRequests.artifactFileName,
            artifactExpiresAt: privacyRequests.artifactExpiresAt
        })
        .from(privacyRequests)
        .where(
            and(
                eq(privacyRequests.id, requestId),
                eq(privacyRequests.userId, userId),
                eq(privacyRequests.requestType, PRIVACY_REQUEST_TYPE_EXPORT),
                eq(privacyRequests.status, PRIVACY_REQUEST_STATUS_COMPLETED)
            )
        )
        .limit(1);

    const request = rows[0] ?? null;
    if (!request?.artifactKey) return null;
    if (request.artifactExpiresAt && request.artifactExpiresAt < now) return null;

    const artifact = await getPrivacyArtifact({ key: request.artifactKey });
    if (!artifact) return null;

    return {
        buffer: artifact.buffer,
        contentType: request.artifactContentType || artifact.metadata?.contentType || 'application/zip',
        fileName: request.artifactFileName || 'om-recipes-export.zip'
    };
}

export async function runPrivacyRetentionCleanup({ now = new Date(), env = process.env } = {}) {
    const config = getPrivacyRetentionConfig(env);
    const magicLinkCutoff = new Date(now.getTime() - config.magicLinkRetentionMs);
    const sessionCutoff = new Date(now.getTime() - config.sessionRetentionMs);
    const requestCutoff = new Date(now.getTime() - config.privacyRequestAuditRetentionMs);
    const abandonedUploadCutoff = new Date(now.getTime() - config.abandonedUploadRetentionMs);

    const deletedMagicLinks = await db
        .delete(authMagicLinks)
        .where(lt(authMagicLinks.expiresAt, magicLinkCutoff))
        .returning({ id: authMagicLinks.id });

    const deletedSessions = await db
        .delete(authSessions)
        .where(
            or(
                lt(authSessions.expiresAt, sessionCutoff),
                and(isNotNull(authSessions.revokedAt), lt(authSessions.revokedAt, sessionCutoff))
            )
        )
        .returning({ id: authSessions.id });

    const expiredExports = await db
        .select({
            id: privacyRequests.id,
            artifactKey: privacyRequests.artifactKey
        })
        .from(privacyRequests)
        .where(
            and(
                eq(privacyRequests.requestType, PRIVACY_REQUEST_TYPE_EXPORT),
                eq(privacyRequests.status, PRIVACY_REQUEST_STATUS_COMPLETED),
                isNotNull(privacyRequests.artifactKey),
                isNotNull(privacyRequests.artifactExpiresAt),
                lt(privacyRequests.artifactExpiresAt, now)
            )
        );

    for (const request of expiredExports) {
        await deletePrivacyArtifact({ key: request.artifactKey }).catch(() => {});
        await updatePrivacyRequest(request.id, {
            artifactKey: null,
            artifactContentType: null,
            artifactFileName: null,
            artifactSizeBytes: null,
            artifactExpiresAt: null
        });
    }

    const deletedPrivacyRequests = await db
        .delete(privacyRequests)
        .where(
            and(
                inArray(privacyRequests.status, [PRIVACY_REQUEST_STATUS_COMPLETED, PRIVACY_REQUEST_STATUS_FAILED]),
                lt(privacyRequests.updatedAt, requestCutoff)
            )
        )
        .returning({ id: privacyRequests.id });

    const abandonedUploads = await db
        .select({
            id: images.id,
            preparedObjectKey: images.preparedObjectKey
        })
        .from(images)
        .where(
            and(
                isNull(images.finalizedAt),
                isNotNull(images.preparedObjectKey),
                lt(images.createdAt, abandonedUploadCutoff)
            )
        );

    if (abandonedUploads.length > 0 && ORIGINAL_BUCKET && getMissingObjectStorageEnvVars(env).length === 0) {
        try {
            const namespaceName = getObjectStorageNamespaceFromEnv(env);
            const client = getObjectStorageClientFromEnv(env);

            for (const upload of abandonedUploads) {
                if (!upload.preparedObjectKey) continue;
                await deleteObject({
                    client,
                    namespaceName,
                    bucketName: ORIGINAL_BUCKET,
                    objectName: upload.preparedObjectKey
                }).catch(() => {});
            }
        } catch (error) {
            console.warn('Skipping abandoned upload OCI deletion:', error?.message || error);
        }
    }

    if (abandonedUploads.length > 0) {
        await db.delete(images).where(inArray(images.id, abandonedUploads.map((row) => row.id)));
    }

    return {
        deletedMagicLinks: deletedMagicLinks.length,
        deletedSessions: deletedSessions.length,
        expiredExportArtifactsCleared: expiredExports.length,
        deletedPrivacyRequests: deletedPrivacyRequests.length,
        deletedAbandonedUploads: abandonedUploads.length
    };
}
