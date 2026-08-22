'use server';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import {
    authors,
    images,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipes
} from '../../db/schema.ts';
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
    computeMonoFingerprint,
    computeMonoNoWbFingerprint,
    computeMonoToneFingerprint,
    computeNoWbFingerprint
} from '../../lib/recipeFingerprint.js';
import { buildRecipeImageAssetUrl } from '../../lib/recipe-image-assets.js';
import { findOrCreateAuthorForUser, requireUser } from '../../lib/auth.js';
import { getRecipePath } from '../../lib/recipe-url.js';
import { revalidatePublicRecipeCatalog } from '../../lib/public-recipe-catalog-cache.js';
import { notifySampleImageAdded } from '../../lib/notifications.js';

const ORIGINAL_BUCKET = process.env.OCI_IMAGES_ORIGINAL_BUCKET;
const RESIZED_BUCKET = process.env.OCI_IMAGES_PROCESSED_BUCKET;
const RESIZE_TIMEOUT_MS = Math.max(0, Number(process.env.IMAGE_RESIZE_TIMEOUT_MS ?? 120000));
const RESIZE_INVOKE_MAX_ATTEMPTS = Math.max(1, Number(process.env.IMAGE_RESIZE_INVOKE_ATTEMPTS ?? 3));
const RESIZE_RETRY_DELAY_MS = Math.max(0, Number(process.env.IMAGE_RESIZE_RETRY_DELAY_MS ?? 15000));
const UPLOAD_DISABLED_ERROR = 'Uploads are disabled right now.';
const ATTACH_RECIPE_REFERENCE_REQUIRED_ERROR = 'matched_recipe_reference_required';
const ATTACH_RECIPE_NOT_FOUND_ERROR = 'matched_recipe_not_found';
const ATTACH_RECIPE_FINGERPRINT_MISMATCH_ERROR = 'matched_recipe_fingerprint_mismatch';

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

function normalizeRecipeReference(recipe) {
    const slug = isBlank(recipe?.slug) ? null : String(recipe.slug).trim();
    const uuidValue = recipe?.uuid ?? recipe?.recipeUuid;
    const uuid = isBlank(uuidValue) ? null : String(uuidValue).trim();

    if (!slug && !uuid) {
        return null;
    }

    return { slug, uuid };
}

async function findRecipeByReference(recipeReference) {
    if (!recipeReference) {
        return null;
    }

    const fields = {
        id: recipes.id,
        uuid: recipes.uuid,
        slug: recipes.slug,
        recipeName: recipes.recipeName,
        authorName: recipes.authorName,
        recipeFingerprint: recipes.recipeFingerprint
    };

    if (recipeReference.uuid) {
        const uuidRows = await db
            .select(fields)
            .from(recipes)
            .where(eq(recipes.uuid, recipeReference.uuid))
            .limit(1);

        return uuidRows[0] ?? null;
    }

    if (!recipeReference.slug) {
        return null;
    }

    const slugRows = await db
        .select(fields)
        .from(recipes)
        .where(eq(recipes.slug, recipeReference.slug))
        .limit(1);

    return slugRows[0] ?? null;
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

function normalizeRecipeType(recipeSettings) {
    return String(recipeSettings?.recipeType ?? '').trim().toUpperCase() === 'MONO' ? 'MONO' : 'COLOR';
}

function getRecipeTypeConfig(recipeType) {
    if (recipeType === 'MONO') {
        return {
            recipeType: 'MONO',
            settingsTable: recipeMonoSettings,
            recipeFingerprintColumn: recipeMonoSettings.recipeFingerprint,
            partialFingerprintColumn: recipeMonoSettings.monoFingerprint,
            toneFingerprintColumn: recipeMonoSettings.monoToneFingerprint,
            noWbFingerprintColumn: recipeMonoSettings.monoNoWbFingerprint,
            computeFingerprints(recipeSettings) {
                return {
                    recipeFingerprint: computeRecipeFingerprint(recipeSettings),
                    partialFingerprint: computeMonoFingerprint(recipeSettings),
                    toneFingerprint: computeMonoToneFingerprint(recipeSettings),
                    noWbFingerprint: computeMonoNoWbFingerprint(recipeSettings)
                };
            },
            buildSettingsValues({ recipeSettings, fingerprints }) {
                return {
                    monochromeProfile: recipeSettings.monochromeProfile ?? null,
                    monochromeColor: recipeSettings.monochromeColor ?? null,
                    monochromeColorStrength: recipeSettings.monochromeColorStrength ?? null,
                    filmGrain: recipeSettings.filmGrain ?? null,
                    filmHue: recipeSettings.filmHue ?? null,
                    monochromeVignetting: recipeSettings.monochromeVignetting ?? null,
                    contrast: recipeSettings.contrast ?? null,
                    sharpness: recipeSettings.sharpness ?? null,
                    highlights: recipeSettings.highlights ?? null,
                    shadows: recipeSettings.shadows ?? null,
                    midtones: recipeSettings.midtones ?? null,
                    shadingEffect: recipeSettings.shadingEffect ?? 0,
                    exposureCompensation: recipeSettings.exposureCompensation ?? 0,
                    whiteBalance2: recipeSettings.whiteBalance2 ?? null,
                    whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature ?? null,
                    whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset ?? null,
                    whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset ?? null,
                    recipeFingerprint: fingerprints.recipeFingerprint,
                    monoFingerprint: fingerprints.partialFingerprint,
                    monoToneFingerprint: fingerprints.toneFingerprint,
                    monoNoWbFingerprint: fingerprints.noWbFingerprint
                };
            }
        };
    }

    return {
        recipeType: 'COLOR',
        settingsTable: recipeColorSettings,
        recipeFingerprintColumn: recipeColorSettings.recipeFingerprint,
        partialFingerprintColumn: recipeColorSettings.colorFingerprint,
        toneFingerprintColumn: recipeColorSettings.colorToneFingerprint,
        noWbFingerprintColumn: recipeColorSettings.noWbFingerprint,
        computeFingerprints(recipeSettings) {
            return {
                recipeFingerprint: computeRecipeFingerprint(recipeSettings),
                partialFingerprint: computeColorFingerprint(recipeSettings),
                toneFingerprint: computeColorToneFingerprint(recipeSettings),
                noWbFingerprint: computeNoWbFingerprint(recipeSettings)
            };
        },
        buildSettingsValues({ recipeSettings, fingerprints }) {
            return {
                yellow: recipeSettings.yellow ?? null,
                orange: recipeSettings.orange ?? null,
                orangeRed: recipeSettings.orangeRed ?? null,
                red: recipeSettings.red ?? null,
                magenta: recipeSettings.magenta ?? null,
                violet: recipeSettings.violet ?? null,
                blue: recipeSettings.blue ?? null,
                blueCyan: recipeSettings.blueCyan ?? null,
                cyan: recipeSettings.cyan ?? null,
                greenCyan: recipeSettings.greenCyan ?? null,
                green: recipeSettings.green ?? null,
                yellowGreen: recipeSettings.yellowGreen ?? null,
                contrast: recipeSettings.contrast ?? null,
                sharpness: recipeSettings.sharpness ?? null,
                highlights: recipeSettings.highlights ?? null,
                shadows: recipeSettings.shadows ?? null,
                midtones: recipeSettings.midtones ?? null,
                shadingEffect: recipeSettings.shadingEffect ?? 0,
                exposureCompensation: recipeSettings.exposureCompensation ?? 0,
                whiteBalance2: recipeSettings.whiteBalance2 ?? null,
                whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature ?? null,
                whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset ?? null,
                whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset ?? null,
                recipeFingerprint: fingerprints.recipeFingerprint,
                colorFingerprint: fingerprints.partialFingerprint,
                colorToneFingerprint: fingerprints.toneFingerprint,
                noWbFingerprint: fingerprints.noWbFingerprint
            };
        }
    };
}

function buildLegacyRecipeMirrorValues({ recipeType, recipeSettings, fingerprints }) {
    return {
        yellow: recipeType === 'COLOR' ? recipeSettings.yellow ?? null : null,
        orange: recipeType === 'COLOR' ? recipeSettings.orange ?? null : null,
        orangeRed: recipeType === 'COLOR' ? recipeSettings.orangeRed ?? null : null,
        red: recipeType === 'COLOR' ? recipeSettings.red ?? null : null,
        magenta: recipeType === 'COLOR' ? recipeSettings.magenta ?? null : null,
        violet: recipeType === 'COLOR' ? recipeSettings.violet ?? null : null,
        blue: recipeType === 'COLOR' ? recipeSettings.blue ?? null : null,
        blueCyan: recipeType === 'COLOR' ? recipeSettings.blueCyan ?? null : null,
        cyan: recipeType === 'COLOR' ? recipeSettings.cyan ?? null : null,
        greenCyan: recipeType === 'COLOR' ? recipeSettings.greenCyan ?? null : null,
        green: recipeType === 'COLOR' ? recipeSettings.green ?? null : null,
        yellowGreen: recipeType === 'COLOR' ? recipeSettings.yellowGreen ?? null : null,
        contrast: recipeSettings.contrast ?? null,
        sharpness: recipeSettings.sharpness ?? null,
        highlights: recipeSettings.highlights ?? null,
        shadows: recipeSettings.shadows ?? null,
        midtones: recipeSettings.midtones ?? null,
        shadingEffect: recipeSettings.shadingEffect ?? 0,
        exposureCompensation: recipeSettings.exposureCompensation ?? 0,
        whiteBalance2: recipeSettings.whiteBalance2 ?? null,
        whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature ?? null,
        whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset ?? null,
        whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset ?? null,
        recipeFingerprint: fingerprints.recipeFingerprint,
        colorFingerprint: fingerprints.partialFingerprint,
        colorToneFingerprint: fingerprints.toneFingerprint,
        noWbFingerprint: fingerprints.noWbFingerprint
    };
}

function buildRecipeCreationStatement({ recipeValues, settingsTable, settingsValues }) {
    const recipeKeys = Object.keys(recipeValues);
    const settingsKeys = Object.keys(settingsValues);
    const recipeInsertColumns = recipeKeys.map((key) => sql.identifier(recipes[key].name));
    const settingsInsertColumns = [sql.identifier(settingsTable.recipeId.name), ...settingsKeys.map((key) => sql.identifier(settingsTable[key].name))];
    const statement = sql`
        with inserted_recipe as (
            insert into ${recipes} (
                ${sql.join(recipeInsertColumns, sql`, `)}
            )
            values (
                ${sql.join(recipeKeys.map((key) => sql`${recipeValues[key]}`), sql`, `)}
            )
            returning ${recipes.id}, ${recipes.uuid}, ${recipes.slug}
        ),
        inserted_settings as (
            insert into ${settingsTable} (
                ${sql.join(settingsInsertColumns, sql`, `)}
            )
            select
                inserted_recipe.id,
                ${sql.join(settingsKeys.map((key) => sql`${settingsValues[key]}`), sql`, `)}
            from inserted_recipe
        )
        select inserted_recipe.id, inserted_recipe.uuid, inserted_recipe.slug
        from inserted_recipe
    `;

    statement.__recipesTable = recipes;
    statement.__settingsTable = settingsTable;
    statement.__recipeValues = recipeValues;
    statement.__settingsValues = settingsValues;

    return statement;
}

async function createRecipeWithSettings({ recipeValues, settingsTable, settingsValues }) {
    const result = await db.execute(
        buildRecipeCreationStatement({
            recipeValues,
            settingsTable,
            settingsValues
        })
    );
    const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
    const inserted = rows[0];
    if (!inserted?.id || !inserted?.slug) {
        throw new Error('Failed to create recipe');
    }
    return inserted;
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

        const { author, name, notes, sourceUrl, imageMeta, recipeSettings, mode, matchedRecipe } = parameters ?? {};
        const explicitAttachRequested = mode === 'attach';
        const explicitAttachRecipe = explicitAttachRequested ? normalizeRecipeReference(matchedRecipe) : null;

        if (isBlank(author)) {
            return { ok: false, error: 'Author Name is required' };
        }
        if (!explicitAttachRequested && isBlank(name)) {
            return { ok: false, error: 'Author Name and Recipe Name are required' };
        }
        if (!imageMeta) return { ok: false, error: 'Image metadata is required' };
        if (!recipeSettings) {
            return { ok: false, error: 'Recipe settings (parsed from EXIF) are required' };
        }
        if (explicitAttachRequested && !explicitAttachRecipe) {
            return {
                ok: false,
                error: 'Matched recipe reference is required for attach uploads',
                errorCode: ATTACH_RECIPE_REFERENCE_REQUIRED_ERROR,
                status: 400
            };
        }

        const recipeType = normalizeRecipeType(recipeSettings);
        const typeConfig = getRecipeTypeConfig(recipeType);

        // Enforce maker notes presence: require the type-appropriate profile settings + Tone Level.
        // These are necessary to produce a valid OM recipe match.
        const hasRequiredProfileSettings =
            recipeType === 'MONO'
                ? recipeSettings?.hasMonochromeProfileSettings
                : recipeSettings?.hasColorProfileSettings;
        if (!hasRequiredProfileSettings) {
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

        const fingerprints = typeConfig.computeFingerprints(recipeSettings);
        const recipeFingerprint = fingerprints.recipeFingerprint;
        let existingRecipe;

        if (explicitAttachRecipe) {
            const exactRecipe = await findRecipeByReference(explicitAttachRecipe);
            if (!exactRecipe) {
                return {
                    ok: false,
                    error: 'Matched recipe was not found',
                    errorCode: ATTACH_RECIPE_NOT_FOUND_ERROR,
                    status: 404
                };
            }

            if (exactRecipe.recipeFingerprint !== recipeFingerprint) {
                return {
                    ok: false,
                    error: 'Matched recipe does not match the uploaded recipe settings',
                    errorCode: ATTACH_RECIPE_FINGERPRINT_MISMATCH_ERROR,
                    status: 409
                };
            }

            existingRecipe = [exactRecipe];
        } else {
            // Dedupe: match existing recipe by fingerprint (settings-only).
            existingRecipe = await db
                .select({
                    id: recipes.id,
                    uuid: recipes.uuid,
                    slug: recipes.slug,
                    recipeName: recipes.recipeName,
                    authorName: recipes.authorName
                })
                .from(recipes)
                .innerJoin(typeConfig.settingsTable, eq(typeConfig.settingsTable.recipeId, recipes.id))
                .where(and(eq(recipes.type, recipeType), eq(typeConfig.recipeFingerprintColumn, recipeFingerprint)))
                .limit(1);
        }

        const shouldCreateRecipe = existingRecipe.length === 0;
        const recipeId = shouldCreateRecipe ? null : existingRecipe[0].id;
        const recipeUuid = shouldCreateRecipe ? null : existingRecipe[0].uuid;
        const slug = shouldCreateRecipe ? null : existingRecipe[0].slug;

        let createdRecipeId = recipeId;
        let createdRecipeUuid = recipeUuid;
        let createdSlug = slug;

        if (shouldCreateRecipe) {
            const normalizedSourceUrl = normalizeOptionalUrl(sourceUrl);
            const baseSlug = `${slugify(author)}_${slugify(name)}`;
            createdSlug = await uniqueRecipeSlug(baseSlug);
            const recipeRow = await createRecipeWithSettings({
                recipeValues: {
                    authorId,
                    slug: createdSlug,
                    type: recipeType,
                    recipeName: String(name),
                    authorName: String(author),
                    description: isBlank(notes) ? null : String(notes),
                    source: recipeSettings.source ?? null,
                    sourceUrl: normalizedSourceUrl,
                    ...buildLegacyRecipeMirrorValues({
                        recipeType,
                        recipeSettings,
                        fingerprints
                    })
                },
                settingsTable: typeConfig.settingsTable,
                settingsValues: typeConfig.buildSettingsValues({
                    recipeSettings,
                    fingerprints
                })
            });

            createdRecipeId = recipeRow.id;
            createdRecipeUuid = recipeRow.uuid;
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

        if (shouldCreateRecipe) await revalidatePublicRecipeCatalog();
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
            await notifySampleImageAdded(preparedRecipeId, requestedImageId, img[0].authorId);
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
            await revalidatePublicRecipeCatalog();
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
        await notifySampleImageAdded(preparedRecipeId, requestedImageId, img[0].authorId);

        if (img[0].smallUrl) {
            resizeStatus.resizeSkipped = true;
            resizeStatus.resizeSucceeded = true;
            await revalidatePublicRecipeCatalog();
            return { ok: true, fullSizeUrl: assetFullSizeUrl, ...resizeStatus };
        }

        resizeStatus.resizeAttempted = true;
        void queueRenditionPublish({
            imageId: requestedImageId,
            authorId: img[0].authorId,
            recipeId: preparedRecipeId,
            objectKey: preparedObjectKey
        });

        await revalidatePublicRecipeCatalog();
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
        const recipeType = normalizeRecipeType(recipeSettings);
        const typeConfig = getRecipeTypeConfig(recipeType);
        const fingerprints = typeConfig.computeFingerprints(recipeSettings);

        const fields = {
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,
            recipeName: recipes.recipeName,
            authorName: recipes.authorName
        };

        const matchQuery = (fingerprintColumn, fingerprintValue) =>
            db
                .select(fields)
                .from(recipes)
                .innerJoin(typeConfig.settingsTable, eq(typeConfig.settingsTable.recipeId, recipes.id))
                .where(and(eq(recipes.type, recipeType), eq(fingerprintColumn, fingerprintValue)))
                .limit(1);

        const [fullRows, noWbRows, colorToneRows, colorRows] = await Promise.all([
            matchQuery(typeConfig.recipeFingerprintColumn, fingerprints.recipeFingerprint),
            matchQuery(typeConfig.noWbFingerprintColumn, fingerprints.noWbFingerprint),
            matchQuery(typeConfig.toneFingerprintColumn, fingerprints.toneFingerprint),
            matchQuery(typeConfig.partialFingerprintColumn, fingerprints.partialFingerprint)
        ]);

        return {
            ok: true,
            full: fullRows[0] ?? null,
            noWb: noWbRows[0] ?? null,
            colorTone: colorToneRows[0] ?? null,
            color: colorRows[0] ?? null
        };
    } catch (e) {
        console.error(e);
        return { ok: false, error: e?.message || String(e) };
    }
}
