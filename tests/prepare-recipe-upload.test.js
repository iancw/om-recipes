import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recipeColorSettings, recipeMonoSettings, recipes } from '../db/schema.ts';

let selectMock;
let insertMock;
let executeMock;
let updateMock;
let createParMock;
let computeRecipeFingerprintMock;
let computeColorFingerprintMock;
let computeColorToneFingerprintMock;
let computeNoWbFingerprintMock;
let computeMonoFingerprintMock;
let computeMonoToneFingerprintMock;
let computeMonoNoWbFingerprintMock;
let requireUserMock;
let findOrCreateAuthorForUserMock;
let revalidatePathMock;
let redirectMock;
let deleteOrphanedImagesByIdsMock;
let notifyNewRecipeMock;
let notifySampleImageAddedMock;

let selectResults = [];
let insertHandlers = [];
let executeResults = [];
let updateHandlers = [];
let selectChains = [];
let capturedRecipeValues = null;
let capturedRecipeSettingsValues = null;
let capturedImageValues = null;
let capturedChildSyncValues = null;
let capturedParentSyncValues = null;
let capturedWhereClauses = [];
const originalDisableUploadsEnv = process.env.NEXT_PUBLIC_DISABLE_UPLOADS;

const makeSelectChain = (result) => {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn((condition) => {
            capturedWhereClauses.push(condition);
            return chain;
        }),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        limit: vi.fn(() => Promise.resolve(typeof result === 'function' ? result(chain) : result)),
        then: (onFulfilled, onRejected) =>
            Promise.resolve(typeof result === 'function' ? result(chain) : result).then(onFulfilled, onRejected)
    };
    return chain;
};

function makeColorRecipeSettings(overrides = {}) {
    return {
        recipeType: 'COLOR',
        hasColorProfileSettings: true,
        hasToneLevel: true,
        yellow: 0,
        orange: 0,
        orangeRed: 0,
        red: 0,
        magenta: 0,
        violet: 0,
        blue: 0,
        blueCyan: 0,
        cyan: 0,
        greenCyan: 0,
        green: 0,
        yellowGreen: 0,
        contrast: 0,
        sharpness: 0,
        highlights: 0,
        shadows: 0,
        midtones: 0,
        whiteBalance2: 'Custom WB 1',
        whiteBalanceTemperature: 5200,
        whiteBalanceAmberOffset: 0,
        whiteBalanceGreenOffset: 0,
        ...overrides
    };
}

function makeMonoRecipeSettings(overrides = {}) {
    return {
        recipeType: 'MONO',
        hasColorProfileSettings: false,
        hasMonochromeProfileSettings: true,
        hasToneLevel: true,
        monochromeProfile: 'MONOTONE',
        monochromeColor: 'Yellow',
        monochromeColorStrength: 1,
        filmGrain: 'Low',
        filmHue: 'Warm',
        monochromeVignetting: 'Low',
        contrast: 0,
        sharpness: 0,
        highlights: 0,
        shadows: 0,
        midtones: 0,
        whiteBalance2: 'Custom WB 1',
        whiteBalanceTemperature: 5200,
        whiteBalanceAmberOffset: 0,
        whiteBalanceGreenOffset: 0,
        ...overrides
    };
}

function queueNewRecipeInsertSequence() {
    executeResults = [
        {
            rows: [{ id: 777, uuid: 'recipe-uuid-1', slug: 'author_recipe-name' }]
        }
    ];
    insertHandlers = [
        () => ({
            values: vi.fn((values) => {
                capturedImageValues = values;
                return {
                    returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
                };
            })
        })
    ];
}

function makeFormData(entries) {
    return {
        get(key) {
            return entries[key] ?? null;
        }
    };
}
function collectSqlTokens(node, tokens = []) {
    if (!node || typeof node !== 'object') {
        return tokens;
    }

    if (typeof node.name === 'string') {
        tokens.push(node.name);
    }

    if ('value' in node && (typeof node.value === 'string' || typeof node.value === 'number')) {
        tokens.push(String(node.value));
    }

    if (Array.isArray(node.queryChunks)) {
        node.queryChunks.forEach((chunk) => collectSqlTokens(chunk, tokens));
    }

    if (Array.isArray(node.value)) {
        node.value.forEach((entry) => collectSqlTokens(entry, tokens));
    }

    return tokens;
}

function getTableName(table) {
    return table?.[Symbol.for('drizzle:Name')] ?? table?.[Symbol.for('drizzle:BaseName')] ?? table?._?.name ?? table?.name ?? null;
}
vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        execute: (...args) => executeMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: () => ({}),
    getObjectStorageNamespaceFromEnv: () => 'namespace',
    createPreauthenticatedRequest: (...args) => createParMock(...args)
}));

vi.mock('../lib/recipeFingerprint.js', () => ({
    computeRecipeFingerprint: (...args) => computeRecipeFingerprintMock(...args),
    computeColorFingerprint: (...args) => computeColorFingerprintMock(...args),
    computeColorToneFingerprint: (...args) => computeColorToneFingerprintMock(...args),
    computeNoWbFingerprint: (...args) => computeNoWbFingerprintMock(...args),
    computeMonoFingerprint: (...args) => computeMonoFingerprintMock(...args),
    computeMonoToneFingerprint: (...args) => computeMonoToneFingerprintMock(...args),
    computeMonoNoWbFingerprint: (...args) => computeMonoNoWbFingerprintMock(...args)
}));

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args),
    findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args)
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

vi.mock('next/navigation', () => ({
    redirect: (...args) => redirectMock(...args)
}));

vi.mock('../lib/oci/deleteOrphanedImages.js', () => ({
    deleteOrphanedImagesByIds: (...args) => deleteOrphanedImagesByIdsMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    notifyNewRecipe: (...args) => notifyNewRecipeMock(...args),
    notifySampleImageAdded: (...args) => notifySampleImageAddedMock(...args)
}));

async function loadActionsModule() {
    return import('../app/upload/actions.js');
}

async function loadRecipeActionsModule() {
    return import('../app/recipes/[id]/actions.js');
}

beforeEach(() => {
    vi.resetModules();
    if (originalDisableUploadsEnv == null) {
        delete process.env.NEXT_PUBLIC_DISABLE_UPLOADS;
    } else {
        process.env.NEXT_PUBLIC_DISABLE_UPLOADS = originalDisableUploadsEnv;
    }
    selectResults = [];
    insertHandlers = [];
    executeResults = [];
    updateHandlers = [];
    selectChains = [];
    capturedRecipeValues = null;
    capturedRecipeSettingsValues = null;
    capturedImageValues = null;
    capturedChildSyncValues = null;
    capturedParentSyncValues = null;
    capturedWhereClauses = [];

    selectMock = vi.fn(() => {
        if (selectResults.length === 0) {
            throw new Error('Unexpected select call');
        }
        const next = selectResults.shift();
        const chain = makeSelectChain(next);
        selectChains.push(chain);
        return chain;
    });

    insertMock = vi.fn(() => {
        if (insertHandlers.length === 0) {
            throw new Error('Unexpected insert call');
        }
        const handler = insertHandlers.shift();
        return handler();
    });
    executeMock = vi.fn((statement) => {
        capturedRecipeValues = statement?.__recipeValues ?? null;
        if (executeResults.length === 0) {
            throw new Error('Unexpected execute call');
        }
        const next = executeResults.shift();
        const result = typeof next === 'function' ? next(statement) : next;
        const insertedRecipeId = result?.rows?.[0]?.id ?? result?.[0]?.id ?? null;
        capturedRecipeSettingsValues = statement?.__settingsValues
            ? {
                  recipeId: insertedRecipeId,
                  ...statement.__settingsValues
              }
            : null;
        return Promise.resolve(result);
    });
    updateMock = vi.fn(() => {
        if (updateHandlers.length === 0) {
            throw new Error('Unexpected update call');
        }
        const handler = updateHandlers.shift();
        return handler();
    });

    createParMock = vi.fn(() => 'https://example.com/upload');
    computeRecipeFingerprintMock = vi.fn(() => 'fp-123');
    computeColorFingerprintMock = vi.fn(() => 'color-fp-123');
    computeColorToneFingerprintMock = vi.fn(() => 'color-tone-fp-123');
    computeNoWbFingerprintMock = vi.fn(() => 'no-wb-fp-123');
    computeMonoFingerprintMock = vi.fn(() => 'mono-fp-123');
    computeMonoToneFingerprintMock = vi.fn(() => 'mono-tone-fp-123');
    computeMonoNoWbFingerprintMock = vi.fn(() => 'mono-no-wb-fp-123');
    requireUserMock = vi.fn(async () => ({
        user: {
            id: 10,
            email: 'author@example.com'
        }
    }));
    findOrCreateAuthorForUserMock = vi.fn(async () => ({
        id: 10,
        uuid: 'author-uuid-1',
        name: 'Author'
    }));
    revalidatePathMock = vi.fn();
    redirectMock = vi.fn();
    deleteOrphanedImagesByIdsMock = vi.fn();
    notifyNewRecipeMock = vi.fn(() => Promise.resolve());
    notifySampleImageAddedMock = vi.fn(() => Promise.resolve());
});

describe('prepareRecipeUploadAction duplicate handling', () => {
    it('rejects uploads when uploads are disabled', async () => {
        process.env.NEXT_PUBLIC_DISABLE_UPLOADS = 'true';

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                links: [],
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 2048,
                    sha256: 'a'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true
                }
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Uploads are disabled right now.'
        });
        expect(requireUserMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(createParMock).not.toHaveBeenCalled();
    });

    it('rejects images without color profile', async () => {
        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                links: [],
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 2048,
                    sha256: 'a'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: false,
                    hasToneLevel: true
                }
            }
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.');
        expect(createParMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('allows OM Workspace images when recipe maker notes are present', async () => {
        selectResults = [
            [],
            [],
            []
        ];

        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 2048,
                    sha256: 'a'.repeat(64)
                },
                recipeSettings: {
                    isOmWorkspace: true,
                    ...makeColorRecipeSettings()
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(createParMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
    });

    it('allows prepare without a client-provided image checksum', async () => {
        selectResults = [
            [
                {
                    id: 321,
                    uuid: 'matched-recipe-uuid',
                    slug: 'existing-recipe',
                    recipeName: 'Existing Recipe',
                    authorName: 'Existing Author'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 2048
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(321);
        expect(capturedImageValues.sha256Hash).toBeNull();
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(createParMock).toHaveBeenCalledTimes(1);
        expect(computeRecipeFingerprintMock).toHaveBeenCalledTimes(1);
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('stores the image SHA-256 digest when creating upload metadata', async () => {
        selectResults = [
            [],
            [],
            []
        ];

        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const digest = 'b'.repeat(64);

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                links: [],
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: digest
                },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(createParMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(capturedImageValues).toBeDefined();
        expect(capturedImageValues.uuid).toBe(result.imageUuid);
        expect(capturedImageValues.sha256Hash).toBe(digest);
        expect(capturedImageValues.validExif).toBe(true);
        expect(capturedImageValues.preparedRecipeId).toBe(777);
        expect(capturedImageValues.preparedObjectKey).toBe(result.objectKey);
        expect(capturedImageValues.smallUrl).toBeNull();
        expect(capturedImageValues.fullSizeUrl).toBeNull();
        expect(selectResults.length).toBe(0);
        expect(insertHandlers.length).toBe(0);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
        expect(notifyNewRecipeMock).toHaveBeenCalledTimes(1);
    });

    it('persists camera metadata fields onto the image row when provided', async () => {
        selectResults = [[], [], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings(),
                cameraMetadata: {
                    camera: 'OM-3',
                    lens: 'OLYMPUS M.17mm F1.8',
                    shutterSpeed: '1/800',
                    aperture: '8.0',
                    focalLength: '17.0 mm',
                    iso: '320'
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBe('OM-3');
        expect(capturedImageValues.lens).toBe('OLYMPUS M.17mm F1.8');
        expect(capturedImageValues.shutterSpeed).toBe('1/800');
        expect(capturedImageValues.aperture).toBe('8.0');
        expect(capturedImageValues.focalLength).toBe('17.0 mm');
        expect(capturedImageValues.iso).toBe('320');
    });

    it('defaults camera metadata fields to null when cameraMetadata is not provided', async () => {
        selectResults = [[], [], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBeNull();
        expect(capturedImageValues.lens).toBeNull();
        expect(capturedImageValues.shutterSpeed).toBeNull();
        expect(capturedImageValues.aperture).toBeNull();
        expect(capturedImageValues.focalLength).toBeNull();
        expect(capturedImageValues.iso).toBeNull();
    });

    it('sanitizes a non-string camera metadata field to null instead of persisting it verbatim', async () => {
        selectResults = [[], [], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings(),
                cameraMetadata: {
                    camera: { malicious: 'object' },
                    lens: 'OLYMPUS M.17mm F1.8',
                    shutterSpeed: '1/800',
                    aperture: '8.0',
                    focalLength: '17.0 mm',
                    iso: '320'
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBeNull();
        expect(capturedImageValues.lens).toBe('OLYMPUS M.17mm F1.8');
    });

    it('truncates an overlong camera metadata field to 200 characters', async () => {
        selectResults = [[], [], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const overlong = 'x'.repeat(500);

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings(),
                cameraMetadata: {
                    camera: overlong,
                    lens: null,
                    shutterSpeed: null,
                    aperture: null,
                    focalLength: null,
                    iso: null
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBe('x'.repeat(200));
        expect(capturedImageValues.camera.length).toBe(200);
    });

    it('sanitizes a whitespace-only camera metadata field to null', async () => {
        selectResults = [[], [], []];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 4096 },
                recipeSettings: makeColorRecipeSettings(),
                cameraMetadata: {
                    camera: '   ',
                    lens: null,
                    shutterSpeed: null,
                    aperture: null,
                    focalLength: null,
                    iso: null
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(capturedImageValues.camera).toBeNull();
    });

    it('binds matched-recipe uploads to the existing recipe on the image row', async () => {
        selectResults = [
            [
                {
                    id: 321,
                    uuid: 'matched-recipe-uuid',
                    slug: 'existing-recipe',
                    recipeName: 'Existing Recipe',
                    authorName: 'Existing Author'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 888 }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: 'e'.repeat(64)
                },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(321);
        expect(result.matchedRecipe).toMatchObject({
            id: 321,
            uuid: 'matched-recipe-uuid',
            slug: 'existing-recipe',
            recipeName: 'Existing Recipe',
            authorName: 'Existing Author'
        });
        expect(capturedImageValues.preparedRecipeId).toBe(321);
        expect(capturedImageValues.preparedObjectKey).toBe(result.objectKey);
        expect(capturedImageValues.uuid).toBe(result.imageUuid);
        expect(executeMock).not.toHaveBeenCalled();
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(insertHandlers.length).toBe(0);
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('honors explicit attach recipe identity instead of an unordered fingerprint match', async () => {
        selectResults = [
            [
                {
                    id: 321,
                    uuid: 'explicit-match-uuid',
                    slug: 'explicit-match',
                    recipeName: 'Explicit Match',
                    authorName: 'Expected Author',
                    recipeFingerprint: 'fp-123'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 888 }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                mode: 'attach',
                matchedRecipe: {
                    slug: 'explicit-match',
                    uuid: 'explicit-match-uuid'
                },
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: 'f'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(321);
        expect(result.matchedRecipe).toMatchObject({
            id: 321,
            uuid: 'explicit-match-uuid',
            slug: 'explicit-match',
            recipeName: 'Explicit Match',
            authorName: 'Expected Author'
        });
        expect(capturedImageValues.preparedRecipeId).toBe(321);
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('resolves attach mode by UUID when the client sends a stale slug with a valid UUID', async () => {
        selectResults = [
            [
                {
                    id: 654,
                    uuid: 'authoritative-uuid',
                    slug: 'current-slug',
                    recipeName: 'Authoritative Recipe',
                    authorName: 'Expected Author',
                    recipeFingerprint: 'fp-123'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 889 }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                mode: 'attach',
                matchedRecipe: {
                    slug: 'stale-slug',
                    uuid: 'authoritative-uuid'
                },
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '2'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(654);
        expect(result.matchedRecipe).toMatchObject({
            id: 654,
            uuid: 'authoritative-uuid',
            slug: 'current-slug',
            recipeName: 'Authoritative Recipe',
            authorName: 'Expected Author'
        });
        expect(capturedImageValues.preparedRecipeId).toBe(654);
        expect(capturedWhereClauses).toHaveLength(1);
        const whereTokens = collectSqlTokens(capturedWhereClauses[0]);
        expect(whereTokens).toContain('uuid');
        expect(whereTokens).toContain('authoritative-uuid');
        expect(whereTokens).not.toContain('slug');
        expect(whereTokens).not.toContain('stale-slug');
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('ignores create-only title and source URL validation when attach mode has a matched recipe identity', async () => {
        selectResults = [
            [
                {
                    id: 777,
                    uuid: 'attach-uuid',
                    slug: 'attach-slug',
                    recipeName: 'Attached Recipe',
                    authorName: 'Expected Author',
                    recipeFingerprint: 'fp-123'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 990 }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: '',
                notes: '',
                sourceUrl: 'not-a-valid-url',
                mode: 'attach',
                matchedRecipe: {
                    slug: 'attach-slug',
                    uuid: 'attach-uuid'
                },
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '3'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(777);
        expect(result.matchedRecipe).toMatchObject({
            id: 777,
            uuid: 'attach-uuid',
            slug: 'attach-slug',
            recipeName: 'Attached Recipe',
            authorName: 'Expected Author'
        });
        expect(capturedImageValues.preparedRecipeId).toBe(777);
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('rejects attach mode when the resolved recipe identity does not match the submitted fingerprint', async () => {
        selectResults = [
            [
                {
                    id: 777,
                    uuid: 'attach-uuid',
                    slug: 'attach-slug',
                    recipeName: 'Attached Recipe',
                    authorName: 'Expected Author',
                    recipeFingerprint: 'different-fingerprint'
                }
            ]
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: '',
                notes: '',
                sourceUrl: 'not-a-valid-url',
                mode: 'attach',
                matchedRecipe: {
                    slug: 'attach-slug',
                    uuid: 'attach-uuid'
                },
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '4'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Matched recipe does not match the uploaded recipe settings',
            errorCode: 'matched_recipe_fingerprint_mismatch',
            status: 409
        });
        expect(insertMock).not.toHaveBeenCalled();
        expect(createParMock).not.toHaveBeenCalled();
        expect(selectResults.length).toBe(0);
    });

    it('fails closed when attach mode is missing a valid matched recipe reference', async () => {
        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                mode: 'attach',
                matchedRecipe: {},
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '1'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Matched recipe reference is required for attach uploads',
            errorCode: 'matched_recipe_reference_required',
            status: 400
        });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(createParMock).not.toHaveBeenCalled();
    });

    it('still uses fingerprint dedupe for create-mode prepares without explicit attach context', async () => {
        selectResults = [
            [
                {
                    id: 321,
                    uuid: 'matched-recipe-uuid',
                    slug: 'existing-recipe',
                    recipeName: 'Existing Recipe',
                    authorName: 'Existing Author'
                }
            ]
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedImageValues = values;
                    return {
                        returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
                    };
                })
            })
        ];

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '5'.repeat(64)
                },
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    yellow: 0,
                    orange: 0,
                    orangeRed: 0,
                    red: 0,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 0,
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(false);
        expect(result.recipeId).toBe(321);
        expect(result.matchedRecipe).toMatchObject({
            slug: 'existing-recipe',
            uuid: 'matched-recipe-uuid'
        });
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(createParMock).toHaveBeenCalledTimes(1);
        expect(selectMock).toHaveBeenCalledTimes(1);
        expect(selectResults.length).toBe(0);
        expect(notifyNewRecipeMock).not.toHaveBeenCalled();
    });

    it('stores a normalized source URL when creating a new recipe', async () => {
        selectResults = [
            [],
            [],
            []
        ];

        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Recipe Name',
                notes: '',
                sourceUrl: 'https://example.com/original-recipe',
                imageMeta: {
                    name: 'photo.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: 'd'.repeat(64)
                },
                recipeSettings: makeColorRecipeSettings({
                    source: 'OM-3/OM System Camera'
                })
            }
        });

        expect(result.ok).toBe(true);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(capturedRecipeValues.source).toBe('OM-3/OM System Camera');
        expect(capturedRecipeValues.sourceUrl).toBe('https://example.com/original-recipe');
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
    });

    it('accepts MONO uploads and writes the mono settings child row', async () => {
        selectResults = [
            [],
            [],
            []
        ];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Mono Recipe',
                notes: '',
                imageMeta: {
                    name: 'mono.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: 'f'.repeat(64)
                },
                recipeSettings: makeMonoRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
        expect(getTableName(executeMock.mock.calls[0][0].__settingsTable)).toBe(getTableName(recipeMonoSettings));
        expect(capturedRecipeValues.type).toBe('MONO');
        expect(capturedRecipeValues).toEqual(
            expect.objectContaining({
                type: 'MONO',
                yellow: null,
                orange: null,
                orangeRed: null,
                red: null,
                magenta: null,
                violet: null,
                blue: null,
                blueCyan: null,
                cyan: null,
                greenCyan: null,
                green: null,
                yellowGreen: null,
                contrast: 0,
                sharpness: 0,
                highlights: 0,
                shadows: 0,
                midtones: 0,
                whiteBalance2: 'Custom WB 1',
                whiteBalanceTemperature: 5200,
                whiteBalanceAmberOffset: 0,
                whiteBalanceGreenOffset: 0,
                recipeFingerprint: 'fp-123',
                colorFingerprint: 'mono-fp-123',
                colorToneFingerprint: 'mono-tone-fp-123',
                noWbFingerprint: 'mono-no-wb-fp-123'
            })
        );
        expect(capturedRecipeSettingsValues).toEqual(
            expect.objectContaining({
                recipeId: 777,
                monochromeProfile: 'MONOTONE',
                monochromeColor: 'Yellow',
                monochromeColorStrength: 1,
                filmGrain: 'Low',
                filmHue: 'Warm',
                monochromeVignetting: 'Low',
                contrast: 0,
                sharpness: 0,
                highlights: 0,
                shadows: 0,
                midtones: 0,
                whiteBalance2: 'Custom WB 1',
                whiteBalanceTemperature: 5200,
                whiteBalanceAmberOffset: 0,
                whiteBalanceGreenOffset: 0,
                recipeFingerprint: 'fp-123',
                monoFingerprint: 'mono-fp-123',
                monoToneFingerprint: 'mono-tone-fp-123',
                monoNoWbFingerprint: 'mono-no-wb-fp-123'
            })
        );
    });

    it('does not match a MONO upload against color recipe fingerprint rows', async () => {
        selectResults = [
            [],
            (chain) => {
                const joinedTable = chain.innerJoin.mock.calls[0]?.[0];
                return joinedTable === recipeMonoSettings
                    ? []
                    : [
                          {
                              id: 321,
                              uuid: 'color-recipe-uuid',
                              slug: 'existing-color-recipe',
                              recipeName: 'Existing Color Recipe',
                              authorName: 'Existing Author'
                          }
                      ];
            },
            [],
            []
        ];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Mono Recipe',
                notes: '',
                imageMeta: {
                    name: 'mono.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '1'.repeat(64)
                },
                recipeSettings: makeMonoRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(selectChains.some((chain) => getTableName(chain.innerJoin.mock.calls[0]?.[0]) === getTableName(recipeMonoSettings))).toBe(true);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(getTableName(executeMock.mock.calls[0][0].__settingsTable)).toBe(getTableName(recipeMonoSettings));
        expect(result.matchedRecipe).toBeNull();
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
    });

    it('preserves the color upload path by writing only the color settings child row', async () => {
        selectResults = [
            [],
            [],
            []
        ];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Color Recipe',
                notes: '',
                imageMeta: {
                    name: 'color.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '2'.repeat(64)
                },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);
        expect(getTableName(executeMock.mock.calls[0][0].__recipesTable)).toBe(getTableName(recipes));
        expect(getTableName(executeMock.mock.calls[0][0].__settingsTable)).toBe(getTableName(recipeColorSettings));
        expect(capturedRecipeValues).toEqual(
            expect.objectContaining({
                type: 'COLOR',
                yellow: 0,
                orange: 0,
                orangeRed: 0,
                red: 0,
                magenta: 0,
                violet: 0,
                blue: 0,
                blueCyan: 0,
                cyan: 0,
                greenCyan: 0,
                green: 0,
                yellowGreen: 0,
                contrast: 0,
                sharpness: 0,
                highlights: 0,
                shadows: 0,
                midtones: 0,
                whiteBalance2: 'Custom WB 1',
                whiteBalanceTemperature: 5200,
                whiteBalanceAmberOffset: 0,
                whiteBalanceGreenOffset: 0,
                recipeFingerprint: 'fp-123',
                colorFingerprint: 'color-fp-123',
                colorToneFingerprint: 'color-tone-fp-123',
                noWbFingerprint: 'no-wb-fp-123'
            })
        );
        expect(capturedRecipeSettingsValues).toEqual(
            expect.objectContaining({
                recipeId: 777,
                yellow: 0,
                orange: 0,
                orangeRed: 0,
                red: 0,
                magenta: 0,
                violet: 0,
                blue: 0,
                blueCyan: 0,
                cyan: 0,
                greenCyan: 0,
                green: 0,
                yellowGreen: 0,
                contrast: 0,
                sharpness: 0,
                highlights: 0,
                shadows: 0,
                midtones: 0,
                whiteBalance2: 'Custom WB 1',
                whiteBalanceTemperature: 5200,
                whiteBalanceAmberOffset: 0,
                whiteBalanceGreenOffset: 0,
                recipeFingerprint: 'fp-123',
                colorFingerprint: 'color-fp-123',
                colorToneFingerprint: 'color-tone-fp-123',
                noWbFingerprint: 'no-wb-fp-123'
            })
        );
    });

    it('builds recipe creation SQL with unqualified insert target columns', async () => {
        selectResults = [
            [],
            [],
            []
        ];
        queueNewRecipeInsertSequence();

        const { prepareRecipeUploadAction } = await loadActionsModule();

        const result = await prepareRecipeUploadAction({
            parameters: {
                author: 'Author',
                name: 'Color Recipe',
                notes: '',
                imageMeta: {
                    name: 'color.jpg',
                    type: 'image/jpeg',
                    size: 4096,
                    sha256: '3'.repeat(64)
                },
                recipeSettings: makeColorRecipeSettings()
            }
        });

        expect(result.ok).toBe(true);
        expect(notifyNewRecipeMock).toHaveBeenCalledWith(result.recipeId);

        const statement = executeMock.mock.calls[0][0];
        const { PgDialect } = await import('drizzle-orm/pg-core');
        const { sql } = new PgDialect().sqlToQuery(statement);
        const compactSql = sql.replace(/\s+/g, ' ').trim();

        expect(compactSql).toContain('insert into "recipes" ( "author_id", "slug", "type"');
        expect(compactSql).not.toContain('insert into "recipes" ( "recipes"."author_id"');
        expect(compactSql).toContain('insert into "recipe_color_settings" ( "recipe_id", "yellow", "orange"');
        expect(compactSql).not.toContain('insert into "recipe_color_settings" ( "recipe_color_settings"."recipe_id"');
    });

    it('detects duplicates via checkImageDuplicateAction', async () => {
        selectResults = [
            [{ id: 555 }],
            [
                {
                    recipeId: 42,
                    recipeSlug: 'dup-slug',
                    recipeUuid: 'dup-uuid',
                    recipeName: 'Duplicate Recipe'
                }
            ],
            []
        ];

        const { checkImageDuplicateAction } = await loadActionsModule();

        const res = await checkImageDuplicateAction({
            parameters: { sha256: 'c'.repeat(64) }
        });

        expect(res.ok).toBe(true);
        expect(res.duplicate).toEqual(
            expect.objectContaining({
                recipeSlug: 'dup-slug',
                recipeName: 'Duplicate Recipe'
            })
        );
        expect(selectResults.length).toBe(0);
    });

    it('scopes recipe matching to MONO fingerprint rows', async () => {
        const onlyIfMonoJoin = (chain) => {
            const joinedTable = chain.innerJoin.mock.calls[0]?.[0];
            return getTableName(joinedTable) === getTableName(recipeMonoSettings)
                ? []
                : [
                      {
                          id: 123,
                          uuid: 'color-recipe-uuid',
                          slug: 'color-recipe',
                          recipeName: 'Color Recipe',
                          authorName: 'Color Author'
                      }
                  ];
        };
        selectResults = [onlyIfMonoJoin, onlyIfMonoJoin, onlyIfMonoJoin, onlyIfMonoJoin];

        const { findRecipeMatchAction } = await loadActionsModule();

        const result = await findRecipeMatchAction({
            parameters: {
                recipeSettings: makeMonoRecipeSettings()
            }
        });

        expect(result).toEqual({
            ok: true,
            full: null,
            noWb: null,
            colorTone: null,
            color: null
        });
        expect(selectChains).toHaveLength(4);
        for (const chain of selectChains) {
            expect(getTableName(chain.innerJoin.mock.calls[0]?.[0])).toBe(getTableName(recipeMonoSettings));
        }
    });
});

describe('updateRecipeAction fingerprint sync', () => {
    it('mirrors MONO child settings back onto the legacy parent columns while refreshing fingerprints', async () => {
        // Slug recompute-on-rename is covered by tests/recipe-slug-rename-action.test.js;
        // stub it here so it does not consume this test's select/update queues.
        vi.doMock('../lib/recipe-slug.js', () => ({
            slugify: (v) => String(v ?? ''),
            computeSlugBase: ({ authorName, recipeName }) => `${authorName ?? ''}_${recipeName ?? ''}`,
            resolveUniqueSlug: ({ base }) => Promise.resolve(base),
            applySlugChange: ({ oldSlug, newSlug }) => Promise.resolve({ changed: oldSlug !== newSlug, newSlug })
        }));

        selectResults = [
            [{ id: 10 }],
            [{ id: 777, uuid: 'recipe-uuid-1', slug: 'mono-recipe', type: 'MONO', authorName: 'Mono Author' }],
            [
                {
                    monochromeProfile: 'MONOTONE',
                    monochromeColor: 'Yellow',
                    monochromeColorStrength: 1,
                    filmGrain: 'Low',
                    filmHue: 'Warm',
                    monochromeVignetting: 'Low',
                    contrast: 0,
                    sharpness: 0,
                    highlights: 0,
                    shadows: 0,
                    midtones: 0,
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 0,
                    whiteBalanceGreenOffset: 0
                }
            ]
        ];
        updateHandlers = [
            () => ({
                set: vi.fn((values) => {
                    capturedChildSyncValues = values;
                    return {
                        where: vi.fn(() => Promise.resolve())
                    };
                })
            }),
            () => ({
                set: vi.fn((values) => {
                    capturedParentSyncValues = values;
                    return {
                        where: vi.fn(() => ({
                            returning: vi.fn(() =>
                                Promise.resolve([{ id: 777, uuid: 'recipe-uuid-1', slug: 'mono-recipe' }])
                            )
                        }))
                    };
                })
            })
        ];

        const { updateRecipeAction } = await loadRecipeActionsModule();

        await updateRecipeAction(
            makeFormData({
                recipeId: '777',
                recipeName: 'Updated Mono Recipe',
                description: 'Updated description',
                sourceUrl: 'https://example.com/source'
            })
        );

        expect(capturedChildSyncValues).toEqual({
            recipeFingerprint: 'fp-123',
            monoFingerprint: 'mono-fp-123',
            monoToneFingerprint: 'mono-tone-fp-123',
            monoNoWbFingerprint: 'mono-no-wb-fp-123'
        });
        expect(capturedParentSyncValues).toEqual(
            expect.objectContaining({
                recipeName: 'Updated Mono Recipe',
                description: 'Updated description',
                sourceUrl: 'https://example.com/source',
                yellow: null,
                orange: null,
                orangeRed: null,
                red: null,
                magenta: null,
                violet: null,
                blue: null,
                blueCyan: null,
                cyan: null,
                greenCyan: null,
                green: null,
                yellowGreen: null,
                contrast: 0,
                sharpness: 0,
                highlights: 0,
                shadows: 0,
                midtones: 0,
                whiteBalance2: 'Custom WB 1',
                whiteBalanceTemperature: 5200,
                whiteBalanceAmberOffset: 0,
                whiteBalanceGreenOffset: 0,
                recipeFingerprint: 'fp-123',
                colorFingerprint: 'mono-fp-123',
                colorToneFingerprint: 'mono-tone-fp-123',
                noWbFingerprint: 'mono-no-wb-fp-123'
            })
        );
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/mono-recipe');
        expect(updateHandlers).toHaveLength(0);
    });
});
