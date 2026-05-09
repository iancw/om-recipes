import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectMock;
let insertMock;
let createParMock;
let computeFingerprintMock;
let requireUserMock;
let findOrCreateAuthorForUserMock;

let selectResults = [];
let insertHandlers = [];
let capturedImageValues = null;
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
        limit: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
    return chain;
};

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

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: () => ({}),
    getObjectStorageNamespaceFromEnv: () => 'namespace',
    createPreauthenticatedRequest: (...args) => createParMock(...args)
}));

vi.mock('../lib/recipeFingerprint.js', () => ({
    computeRecipeFingerprint: (...args) => computeFingerprintMock(...args),
    computeColorFingerprint: () => 'color-fp-123',
    computeColorToneFingerprint: () => 'color-tone-fp-123',
    computeNoWbFingerprint: () => 'no-wb-fp-123'
}));

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args),
    findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args)
}));

async function loadActionsModule() {
    return import('../app/upload/actions.js');
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
    capturedImageValues = null;
    capturedWhereClauses = [];

    selectMock = vi.fn(() => {
        if (selectResults.length === 0) {
            throw new Error('Unexpected select call');
        }
        const next = selectResults.shift();
        return makeSelectChain(next);
    });

    insertMock = vi.fn(() => {
        if (insertHandlers.length === 0) {
            throw new Error('Unexpected insert call');
        }
        const handler = insertHandlers.shift();
        return handler();
    });

    createParMock = vi.fn(() => 'https://example.com/upload');
    computeFingerprintMock = vi.fn(() => 'fp-123');
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

        insertHandlers = [
            () => ({
                values: vi.fn(() => ({
                    returning: vi.fn(() =>
                        Promise.resolve([{ id: 777, uuid: 'recipe-uuid-1', slug: 'author_recipe-name' }])
                    )
                }))
            }),
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
                    size: 2048,
                    sha256: 'a'.repeat(64)
                },
                recipeSettings: {
                    isOmWorkspace: true,
                    hasColorProfileSettings: true,
                    hasToneLevel: true
                }
            }
        });

        expect(result.ok).toBe(true);
        expect(createParMock).toHaveBeenCalledTimes(1);
        expect(insertMock).toHaveBeenCalledTimes(2);
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
        expect(computeFingerprintMock).toHaveBeenCalledTimes(1);
        expect(selectResults.length).toBe(0);
    });

    it('stores the image SHA-256 digest when creating upload metadata', async () => {
        selectResults = [
            [],
            []
        ];

        insertHandlers = [
            () => ({
                values: vi.fn(() => ({
                    returning: vi.fn(() =>
                        Promise.resolve([{ id: 777, uuid: 'recipe-uuid-1', slug: 'author_recipe-name' }])
                    )
                }))
            }),
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

        const digest = 'b'.repeat(64);
        const baseRecipeSettings = {
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
        };

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
                recipeSettings: baseRecipeSettings
            }
        });

        expect(result.ok).toBe(true);
        expect(result.shouldCreateRecipe).toBe(true);
        expect(createParMock).toHaveBeenCalledTimes(1);
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
            uuid: 'matched-recipe-uuid',
            slug: 'existing-recipe',
            recipeName: 'Existing Recipe',
            authorName: 'Existing Author'
        });
        expect(capturedImageValues.preparedRecipeId).toBe(321);
        expect(capturedImageValues.preparedObjectKey).toBe(result.objectKey);
        expect(capturedImageValues.uuid).toBe(result.imageUuid);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(insertHandlers.length).toBe(0);
        expect(selectResults.length).toBe(0);
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
    });

    it('stores a normalized source URL when creating a new recipe', async () => {
        let capturedRecipeValues = null;
        selectResults = [
            [],
            [],
            []
        ];

        insertHandlers = [
            () => ({
                values: vi.fn((values) => {
                    capturedRecipeValues = values;
                    return {
                        returning: vi.fn(() =>
                            Promise.resolve([{ id: 777, uuid: 'recipe-uuid-1', slug: 'author_recipe-name' }])
                        )
                    };
                })
            }),
            () => ({
                values: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
                }))
            })
        ];

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
                recipeSettings: {
                    hasColorProfileSettings: true,
                    hasToneLevel: true,
                    source: 'OM-3/OM System Camera',
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
        expect(capturedRecipeValues.source).toBe('OM-3/OM System Camera');
        expect(capturedRecipeValues.sourceUrl).toBe('https://example.com/original-recipe');
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
});
