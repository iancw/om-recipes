'use server';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import { authors, images, recipeComparisonImages, recipeSampleImages, recipes } from '../../db/schema.ts';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
    getObjectStorageClientFromEnv,
    getObjectStorageNamespaceFromEnv,
    getObject,
    headObject,
    createPreauthenticatedRequest,
    deleteObject
} from '../../lib/oci/objectStorage.js';
import { invokeImageResizeFunction } from '../../lib/oci/functionsInvoke.js';
import { ResizeTimeoutError } from './errors.js';

import {
    computeRecipeFingerprint,
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeNoWbFingerprint
} from '../../lib/recipeFingerprint.js';
import { buildRecipeImageAssetUrl } from '../../lib/recipe-image-assets.js';
import { findOrCreateAuthorForUser, requireUser } from '../../lib/auth.js';
import { getRecipePath } from '../../lib/recipe-url.js';

const ORIGINAL_BUCKET = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
const RESIZED_BUCKET = process.env.OCI_IMAGES_PROCESSED_BUCKET;
const RESIZE_TIMEOUT_MS = Math.max(0, Number(process.env.IMAGE_RESIZE_TIMEOUT_MS ?? 120000));
const RESIZE_INVOKE_MAX_ATTEMPTS = Math.max(1, Number(process.env.IMAGE_RESIZE_INVOKE_ATTEMPTS ?? 3));
const RESIZE_RETRY_DELAY_MS = Math.max(0, Number(process.env.IMAGE_RESIZE_RETRY_DELAY_MS ?? 15000));
const UPLOAD_DISABLED_ERROR = 'Uploads are disabled right now.';

function withResizeTimeout(promise, timeoutMs) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    let timer;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            reject(new ResizeTimeoutError(timeoutMs));
        }, timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((err) => {
                clearTimeout(timer);
                reject(err);
            });
    });
}

function shouldRetryResizeInvoke(err) {
    const message = String(err?.message ?? '').toLowerCase();
    const detailsStatus = err?.details?.status;
    const metadataCode = err?.details?.metadata?.statusCode;
    const explicitStatus = err?.statusCode;
    const causeStatus = err?.cause?.statusCode;
    const status =
        typeof explicitStatus === 'number'
            ? explicitStatus
            : typeof detailsStatus === 'number'
              ? detailsStatus
              : typeof metadataCode === 'number'
                ? metadataCode
                : typeof causeStatus === 'number'
                  ? causeStatus
                  : null;

    return status === 502 || status === 503 || message.includes('server too busy') || message.includes('502') || message.includes('503');
}

function sleep(ms) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function uploadsAreDisabled() {
    return String(process.env.NEXT_PUBLIC_DISABLE_UPLOADS ?? '').toLowerCase() === 'true';
}

async function invokeResizeWithRetry({ sourceBucket, objectName, destinationBucket, timeoutMs }) {
    let lastError;
    for (let attempt = 1; attempt <= RESIZE_INVOKE_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await withResizeTimeout(
                invokeImageResizeFunction({
                    sourceBucket,
                    objectName,
                    destinationBucket,
                    timeoutMs
                }),
                timeoutMs
            );
        } catch (err) {
            lastError = err;
            const canRetry = shouldRetryResizeInvoke(err);
            if (!canRetry || attempt === RESIZE_INVOKE_MAX_ATTEMPTS) {
                break;
            }
            await sleep(RESIZE_RETRY_DELAY_MS * attempt);
        }
    }
    throw lastError;
}

// OES files are generated dynamically on request at /oes/<slug>.oes

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function normalizeOptionalUrl(value) {
    if (isBlank(value)) return null;
    const raw = String(value).trim();

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('Source URL must be a valid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Source URL must start with http:// or https://');
    }

    return parsed.toString();
}

function slugify(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

async function uniqueRecipeSlug(base) {
    let slug = base;
    for (let i = 1; i < 1000; i++) {
        const existing = await db.select({ slug: recipes.slug }).from(recipes).where(eq(recipes.slug, slug)).limit(1);
        if (existing.length === 0) return slug;
        slug = `${base}-${i + 1}`;
    }
    throw new Error('Unable to generate a unique slug');
}

function inferImageExtension(file) {
    const name = String(file?.name ?? '');
    const m = name.match(/\.([a-zA-Z0-9]+)$/);
    if (!m) return 'jpg';
    const ext = m[1].toLowerCase();
    // Keep it conservative.
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff'].includes(ext)) return ext;
    return 'jpg';
}

function originalUrlForKey(key) {
    return `/assets/images/original/${key}`;
}

function fiveMinutesFromNow() {
    return new Date(Date.now() + 5 * 60 * 1000);
}

function normalizeSha256(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizePositiveInteger(value) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) return null;
    return normalized;
}

async function findExistingImageAssociationBySha(sha256) {
    if (!sha256) return null;

    const existing = await db
        .select({ id: images.id })
        .from(images)
        .where(eq(images.sha256Hash, sha256))
        .limit(1);

    if (existing.length === 0) return null;

    return findExistingImageAssociationByImageId(existing[0].id);
}

async function findExistingImageAssociationByImageId(imageId) {
    if (!imageId) return null;

    const [sampleRows, comparisonRows] = await Promise.all([
        db
            .select({
                recipeId: recipes.id,
                recipeSlug: recipes.slug,
                recipeUuid: recipes.uuid,
                recipeName: recipes.recipeName
            })
            .from(recipeSampleImages)
            .innerJoin(recipes, eq(recipeSampleImages.recipeId, recipes.id))
            .where(eq(recipeSampleImages.imageId, imageId))
            .limit(1),
        db
            .select({
                recipeId: recipes.id,
                recipeSlug: recipes.slug,
                recipeUuid: recipes.uuid,
                recipeName: recipes.recipeName
            })
            .from(recipeComparisonImages)
            .innerJoin(recipes, eq(recipeComparisonImages.recipeId, recipes.id))
            .where(eq(recipeComparisonImages.imageId, imageId))
            .limit(1)
    ]);

    if (sampleRows.length > 0) {
        return {
            ...sampleRows[0],
            imageId,
            duplicateType: 'sample'
        };
    }

    if (comparisonRows.length > 0) {
        return {
            ...comparisonRows[0],
            imageId,
            duplicateType: 'comparison'
        };
    }

    return {
        imageId,
        recipeId: null,
        recipeSlug: null,
        recipeUuid: null,
        recipeName: null,
        duplicateType: null
    };
}

async function findExistingImageAssociationByShaExcludingImage(sha256, excludeImageId) {
    if (!sha256) return null;

    const conditions = [eq(images.sha256Hash, sha256)];
    if (excludeImageId) {
        conditions.push(ne(images.id, excludeImageId));
    }

    const existing = await db
        .select({ id: images.id })
        .from(images)
        .where(and(...conditions))
        .limit(1);

    if (existing.length === 0) return null;

    return findExistingImageAssociationByImageId(existing[0].id);
}

function queueRenditionPublish({ imageId, authorId, recipeId, objectKey }) {
    return invokeResizeWithRetry({
        sourceBucket: ORIGINAL_BUCKET,
        objectName: objectKey,
        destinationBucket: RESIZED_BUCKET,
        timeoutMs: RESIZE_TIMEOUT_MS
    }).catch((err) => {
        let errorType = 'invoke_error';
        if (err instanceof ResizeTimeoutError) {
            errorType = 'timeout';
        } else if (err?.__verify_error) {
            errorType = 'verify_error';
        }
        const warnMessage = err?.message ?? String(err);
        const warnDetails = err?.details ?? (typeof err === 'object' ? err : null);
        const warnPreview = err?.preview ?? null;
        const warnCause = err?.cause ?? null;
        console.warn('Image resize failed', {
            error: warnMessage,
            message: warnMessage,
            errorType,
            details: warnDetails,
            preview: warnPreview,
            cause: warnCause,
            imageId,
            objectKey,
            bucket: RESIZED_BUCKET,
            authorId,
            recipeId
        });
    });
}

function buildDuplicateImageErrorMessage(duplicate) {
    const sampleLabel =
        duplicate?.duplicateType === 'comparison'
            ? 'a comparison image'
            : 'a sample image';

    let errorMessage = `This image is already on OM Recipes as ${sampleLabel}`;
    if (duplicate?.recipeName) {
        errorMessage += ` for "${duplicate.recipeName}"`;
    }

    const recipePath = getRecipePath({
        slug: duplicate?.recipeSlug,
        uuid: duplicate?.recipeUuid
    });
    if (recipePath !== '/recipes') {
        errorMessage += `. View it at ${recipePath}.`;
    } else {
        errorMessage += '.';
    }

    return errorMessage;
}

async function sha256HexFromObjectStorageResponse(response) {
    const body = response?.value ?? response?.body ?? response?.data ?? response;
    const hash = createHash('sha256');

    if (!body) {
        throw new Error('Uploaded object body was empty');
    }

    if (typeof body.arrayBuffer === 'function') {
        hash.update(Buffer.from(await body.arrayBuffer()));
        return hash.digest('hex');
    }

    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        hash.update(body);
        return hash.digest('hex');
    }

    if (typeof body[Symbol.asyncIterator] === 'function' || typeof body[Symbol.iterator] === 'function') {
        for await (const chunk of body) {
            if (!chunk) continue;
            hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return hash.digest('hex');
    }

    throw new Error('Unsupported uploaded object body type');
}

// Always be sanitizing data in real sites!
export async function prepareRecipeUploadAction({ parameters }) {
    try {
        if (uploadsAreDisabled()) {
            return { ok: false, error: UPLOAD_DISABLED_ERROR };
        }

        const session = await requireUser();

        const { author, name, notes, sourceUrl, imageMeta, recipeSettings } = parameters ?? {};

        if (isBlank(author) || isBlank(name)) {
            return { ok: false, error: 'Author Name and Recipe Name are required' };
        }
        if (!imageMeta) return { ok: false, error: 'Image metadata is required' };
        if (!recipeSettings) {
            return { ok: false, error: 'Recipe settings (parsed from EXIF) are required' };
        }

        // Enforce maker notes presence: require Color Profile Settings + Tone Level.
        // These are necessary to produce a valid OM recipe match.
        if (!recipeSettings?.hasColorProfileSettings) {
            return {
                ok: false,
                error: 'No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.'
            };
        }
        if (!recipeSettings?.hasToneLevel) {
            return {
                ok: false,
                error: 'Missing required maker notes: Tone Level'
            };
        }

        // Server-side validation: only accept JPEG uploads.
        // (Client should already filter, but do not trust it.)
        const contentType = String(imageMeta?.type ?? '').toLowerCase();
       const filename = String(imageMeta?.name ?? '').toLowerCase();
       const isJpeg = contentType === 'image/jpeg' || filename.endsWith('.jpg') || filename.endsWith('.jpeg');
       if (!isJpeg) {
           return { ok: false, error: 'Only JPEG (.jpg/.jpeg) images are accepted' };
       }

        const rawSha = imageMeta?.sha256;
        if (rawSha != null && rawSha !== '' && !normalizeSha256(rawSha)) {
            return {
                ok: false,
                error: 'Image checksum missing or invalid. Please reselect the file and try again.'
            };
        }
        const imageSha = normalizeSha256(rawSha);

        const authorRow = await findOrCreateAuthorForUser({
            userId: session.user.id,
            email: session.user.email,
            displayName: author
        });
        const authorId = authorRow.id;
        const authorUuid = authorRow.uuid;

        const recipeFingerprint = computeRecipeFingerprint(recipeSettings);
        const colorFingerprint = computeColorFingerprint(recipeSettings);
        const colorToneFingerprint = computeColorToneFingerprint(recipeSettings);
        const noWbFingerprint = computeNoWbFingerprint(recipeSettings);

        // Dedupe: match existing recipe by fingerprint (settings-only).
        const existingRecipe = await db
            .select({
                id: recipes.id,
                uuid: recipes.uuid,
                slug: recipes.slug,
                recipeName: recipes.recipeName,
                authorName: recipes.authorName
            })
            .from(recipes)
            .where(eq(recipes.recipeFingerprint, recipeFingerprint))
            .limit(1);

        const shouldCreateRecipe = existingRecipe.length === 0;
        const recipeId = shouldCreateRecipe ? null : existingRecipe[0].id;
        const recipeUuid = shouldCreateRecipe ? null : existingRecipe[0].uuid;
        const slug = shouldCreateRecipe ? null : existingRecipe[0].slug;

        let createdRecipeId = recipeId;
        let createdRecipeUuid = recipeUuid;
        let createdSlug = slug;
        const normalizedSourceUrl = normalizeOptionalUrl(sourceUrl);

        if (shouldCreateRecipe) {
            const baseSlug = `${slugify(author)}_${slugify(name)}`;
            createdSlug = await uniqueRecipeSlug(baseSlug);

            // --- db writes
            const recipeRow = await db
                .insert(recipes)
                .values({
                    authorId,
                    slug: createdSlug,
                    recipeName: String(name),
                    authorName: String(author),
                    description: isBlank(notes) ? null : String(notes),
                    source: recipeSettings.source ?? null,
                    sourceUrl: normalizedSourceUrl,

                    recipeFingerprint,
                    colorFingerprint,
                    colorToneFingerprint,
                    noWbFingerprint,

                    yellow: recipeSettings.yellow,
                    orange: recipeSettings.orange,
                    orangeRed: recipeSettings.orangeRed,
                    red: recipeSettings.red,
                    magenta: recipeSettings.magenta,
                    violet: recipeSettings.violet,
                    blue: recipeSettings.blue,
                    blueCyan: recipeSettings.blueCyan,
                    cyan: recipeSettings.cyan,
                    greenCyan: recipeSettings.greenCyan,
                    green: recipeSettings.green,
                    yellowGreen: recipeSettings.yellowGreen,

                    contrast: recipeSettings.contrast,
                    sharpness: recipeSettings.sharpness,
                    highlights: recipeSettings.highlights,
                    shadows: recipeSettings.shadows,
                    midtones: recipeSettings.midtones,

                    // these aren’t currently parsed into recipeSettings; default 0
                    shadingEffect: 0,
                    exposureCompensation: 0,

                    whiteBalance2: recipeSettings.whiteBalance2,
                    whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature,
                    whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset,
                    whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset
                })
                .returning({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug });

            createdRecipeId = recipeRow[0].id;
            createdRecipeUuid = recipeRow[0].uuid;
        }

        if (!createdRecipeId || !createdSlug) {
            throw new Error('Internal error: missing recipe id/slug');
        }

        const imageUuid = randomUUID();
        const ext = inferImageExtension(imageMeta);
        const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
        const objectKey = `authors/${authorUuid}/recipes/${createdSlug}/${imageUuid}.${normalizedExt}`;

        const imageRow = await db
            .insert(images)
            .values({
                authorId,
                uuid: imageUuid,
                // set after upload so we can include UUID in the object key
                fullSizeUrl: null,
                // async resize means this may not exist immediately, but URL is deterministic
                smallUrl: null,
                originalFileSize: imageMeta?.size || null,
                validExif: true,
                sha256Hash: imageSha,
                preparedRecipeId: createdRecipeId,
                preparedObjectKey: objectKey
            })
            .returning({ id: images.id });

        const imageId = imageRow[0].id;

        const namespaceName = getObjectStorageNamespaceFromEnv();
        const client = getObjectStorageClientFromEnv();

        const parUrl = await createPreauthenticatedRequest({
            client,
            namespaceName,
            bucketName: ORIGINAL_BUCKET,
            objectName: objectKey,
            accessType: 'ObjectWrite',
            expiresAt: fiveMinutesFromNow(),
            name: `upload-${imageUuid}`
        });

        return {
            ok: true,
            parUrl,
            objectKey,
            authorId,
            shouldCreateRecipe,
            slug: createdSlug,
            recipeId: createdRecipeId,
            imageId,
            recipeUuid: createdRecipeUuid,
            imageUuid,
            authorUuid,
            matchedRecipe: shouldCreateRecipe ? null : existingRecipe[0]
        };
    } catch (e) {
        console.error(e);
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function checkImageDuplicateAction({ parameters }) {
    try {
        await requireUser();

        const sha = normalizeSha256(parameters?.sha256);
        if (!sha) {
            return { ok: false, error: 'Invalid image checksum' };
        }

        const duplicate = await findExistingImageAssociationBySha(sha);
        if (!duplicate) {
            return { ok: true, duplicate: null };
        }

        return {
            ok: true,
            duplicate: {
                recipeId: duplicate.recipeId,
                recipeSlug: duplicate.recipeSlug,
                recipeUuid: duplicate.recipeUuid,
                recipeName: duplicate.recipeName,
                duplicateType: duplicate.duplicateType
            }
        };
    } catch (e) {
        console.error(e);
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function finalizeRecipeUploadAction({ parameters }) {
    try {
        if (uploadsAreDisabled()) {
            return { ok: false, error: UPLOAD_DISABLED_ERROR };
        }

        const session = await requireUser();

        const {
            imageId,
            originalFileSize
        } = parameters ?? {};

        const requestedImageId = normalizePositiveInteger(imageId);
        if (!requestedImageId) {
            return { ok: false, error: 'Missing required finalize parameters' };
        }

        const img = await db
            .select({
                id: images.id,
                authorId: images.authorId,
                authorUserId: authors.userId,
                smallUrl: images.smallUrl,
                fullSizeUrl: images.fullSizeUrl,
                sha256Hash: images.sha256Hash,
                originalFileSize: images.originalFileSize,
                preparedRecipeId: images.preparedRecipeId,
                preparedObjectKey: images.preparedObjectKey,
                finalizedAt: images.finalizedAt
            })
            .from(images)
            .innerJoin(authors, eq(images.authorId, authors.id))
            .where(eq(images.id, requestedImageId))
            .limit(1);
        if (img.length === 0) return { ok: false, error: 'Image record not found' };
        if (img[0].authorUserId !== session.user.id) return { ok: false, error: 'Not authorized' };

        const preparedRecipeId = normalizePositiveInteger(img[0].preparedRecipeId);
        const preparedObjectKey = String(img[0].preparedObjectKey ?? '').trim();
        if (!preparedRecipeId || !preparedObjectKey) {
            return { ok: false, error: 'Upload is missing prepared finalize state. Please upload the image again.' };
        }

        const assetFullSizeUrl = buildRecipeImageAssetUrl({
            objectKey: preparedObjectKey,
            rendition: 'original'
        });
        const storedFullSizeUrl = img[0].fullSizeUrl || originalUrlForKey(preparedObjectKey);
        const resizeStatus = {
            resizeAttempted: false,
            resizeSucceeded: false,
            resizeSkipped: false
        };

        const ensureRecipeSampleImageLink = async () =>
            db
                .insert(recipeSampleImages)
                .values({
                    recipeId: preparedRecipeId,
                    imageId: requestedImageId,
                    authorId: img[0].authorId,
                    isPrimary: sql`not exists (
                        select 1
                        from recipe_sample_images existing_samples
                        where existing_samples.recipe_id = ${preparedRecipeId}
                    )`
                })
                .onConflictDoNothing();

        if (img[0].finalizedAt) {
            await ensureRecipeSampleImageLink();
            if (img[0].smallUrl) {
                resizeStatus.resizeSucceeded = true;
                resizeStatus.resizeSkipped = true;
            } else {
                resizeStatus.resizeAttempted = true;
                void queueRenditionPublish({
                    imageId: requestedImageId,
                    authorId: img[0].authorId,
                    recipeId: preparedRecipeId,
                    objectKey: preparedObjectKey
                });
            }
            return { ok: true, fullSizeUrl: assetFullSizeUrl, ...resizeStatus };
        }

        const namespaceName = getObjectStorageNamespaceFromEnv();
        const client = getObjectStorageClientFromEnv();
        const expectedOriginalFileSize = normalizePositiveInteger(img[0].originalFileSize) ?? normalizePositiveInteger(originalFileSize);

        // Verify the object exists (helps surface CORS/PAR issues and avoids dangling DB URLs).
        try {
            const headRes = await headObject({
                client,
                namespaceName,
                bucketName: ORIGINAL_BUCKET,
                objectName: preparedObjectKey
            });

            // Best-effort validation.
            const len = Number(headRes?.contentLength);
            if (Number.isFinite(len) && expectedOriginalFileSize != null && len !== expectedOriginalFileSize) {
                return {
                    ok: false,
                    error: `Uploaded object size mismatch (expected ${expectedOriginalFileSize}, got ${len})`
                };
            }
        } catch (e) {
            return {
                ok: false,
                error: `Upload not found in storage (did the direct upload fail or PAR expire?): ${e?.message || String(e)}`
            };
        }

        const imageSha =
            normalizeSha256(img[0].sha256Hash) ??
            (await sha256HexFromObjectStorageResponse(
                await getObject({
                    client,
                    namespaceName,
                    bucketName: ORIGINAL_BUCKET,
                    objectName: preparedObjectKey
                })
            ));

        const duplicate = await findExistingImageAssociationByShaExcludingImage(imageSha, requestedImageId);
        if (duplicate) {
            try {
                await deleteObject({
                    client,
                    namespaceName,
                    bucketName: ORIGINAL_BUCKET,
                    objectName: preparedObjectKey
                });
            } catch (cleanupErr) {
                console.warn('Prepared duplicate upload cleanup failed', {
                    imageId: requestedImageId,
                    objectKey: preparedObjectKey,
                    error: cleanupErr?.message ?? String(cleanupErr)
                });
            }

            await db.delete(images).where(eq(images.id, requestedImageId));

            return {
                ok: false,
                error: buildDuplicateImageErrorMessage(duplicate)
            };
        }

        await db
            .update(images)
            .set({
                fullSizeUrl: storedFullSizeUrl,
                sha256Hash: imageSha,
                originalFileSize: expectedOriginalFileSize ?? null,
                finalizedAt: new Date()
            })
            .where(and(eq(images.id, requestedImageId), isNull(images.finalizedAt)));

        await ensureRecipeSampleImageLink();

        if (img[0].smallUrl) {
            resizeStatus.resizeSkipped = true;
            resizeStatus.resizeSucceeded = true;
            return { ok: true, fullSizeUrl: assetFullSizeUrl, ...resizeStatus };
        }

        resizeStatus.resizeAttempted = true;
        void queueRenditionPublish({
            imageId: requestedImageId,
            authorId: img[0].authorId,
            recipeId: preparedRecipeId,
            objectKey: preparedObjectKey
        });

        return { ok: true, fullSizeUrl: assetFullSizeUrl, ...resizeStatus };
    } catch (e) {
        console.error(e);
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function findRecipeMatchAction({ parameters }) {
    try {
        await requireUser();

        const { recipeSettings } = parameters ?? {};
        if (!recipeSettings) {
            return { ok: false, error: 'Recipe settings are required' };
        }

        const fields = {
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,
            recipeName: recipes.recipeName,
            authorName: recipes.authorName
        };

        const [fullRows, noWbRows, colorToneRows, colorRows] = await Promise.all([
            db.select(fields).from(recipes).where(eq(recipes.recipeFingerprint, computeRecipeFingerprint(recipeSettings))).limit(1),
            db.select(fields).from(recipes).where(eq(recipes.noWbFingerprint, computeNoWbFingerprint(recipeSettings))).limit(1),
            db.select(fields).from(recipes).where(eq(recipes.colorToneFingerprint, computeColorToneFingerprint(recipeSettings))).limit(1),
            db.select(fields).from(recipes).where(eq(recipes.colorFingerprint, computeColorFingerprint(recipeSettings))).limit(1),
        ]);

        return {
            ok: true,
            full: fullRows[0] ?? null,
            noWb: noWbRows[0] ?? null,
            colorTone: colorToneRows[0] ?? null,
            color: colorRows[0] ?? null,
        };
    } catch (e) {
        console.error(e);
        return { ok: false, error: e?.message || String(e) };
    }
}
