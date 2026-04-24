import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let selectMock = vi.fn();
let insertMock = vi.fn();
let updateMock = vi.fn();
let transactionMock = vi.fn();
let headObjectMock = vi.fn();
let invokeMock = vi.fn();
let requireUserMock = vi.fn();
let finalizeRecipeUploadAction;
let ResizeTimeoutError;
let updateSetCalls = [];
let insertValuesCalls = [];
let consoleWarnMock;
let selectedImageRow = null;
const originalDisableUploadsEnv = process.env.NEXT_PUBLIC_DISABLE_UPLOADS;

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(() => Promise.resolve(result))
    };
}

vi.mock('../lib/auth.js', () => ({
    requireUser: (...args) => requireUserMock(...args)
}));

vi.mock('../lib/oci/functionsInvoke.js', () => ({
    invokeImageResizeFunction: (...args) => invokeMock(...args)
}));

vi.mock('../lib/oci/objectStorage.js', () => ({
    getObjectStorageClientFromEnv: () => ({}),
    getObjectStorageNamespaceFromEnv: () => 'namespace',
    headObject: (...args) => headObjectMock(...args)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args),
        transaction: (...args) => transactionMock(...args)
    }
}));

describe('finalizeRecipeUploadAction security and resize orchestration', () => {
    beforeEach(async () => {
        vi.resetModules();
        if (originalDisableUploadsEnv == null) {
            delete process.env.NEXT_PUBLIC_DISABLE_UPLOADS;
        } else {
            process.env.NEXT_PUBLIC_DISABLE_UPLOADS = originalDisableUploadsEnv;
        }

        selectedImageRow = {
            id: 2,
            authorId: 30,
            authorUserId: 3,
            smallUrl: null,
            fullSizeUrl: null,
            originalFileSize: 100,
            preparedRecipeId: 1,
            preparedObjectKey: 'authors/foo/recipes/img.jpg',
            finalizedAt: null
        };
        updateSetCalls = [];
        insertValuesCalls = [];
        headObjectMock = vi.fn();
        invokeMock = vi.fn();
        requireUserMock = vi.fn(async () => ({
            user: {
                id: 3,
                email: 'owner@example.com'
            }
        }));
        selectMock = vi.fn(() => makeSelectChain(selectedImageRow ? [selectedImageRow] : []));
        insertMock = vi.fn(() => ({
            values: vi.fn((values) => {
                insertValuesCalls.push(values);
                return { onConflictDoNothing: () => Promise.resolve([]) };
            })
        }));
        updateMock = vi.fn(() => ({
            set: (values) => {
                updateSetCalls.push(values);
                return { where: () => Promise.resolve([]) };
            }
        }));
        transactionMock = vi.fn(async (callback) =>
            callback({
                insert: (...args) => insertMock(...args),
                update: (...args) => updateMock(...args)
            })
        );

        const actions = await import('../app/upload/actions.js');
        const errors = await import('../app/upload/errors.js');
        finalizeRecipeUploadAction = actions.finalizeRecipeUploadAction;
        ResizeTimeoutError = errors.ResizeTimeoutError;

        consoleWarnMock?.mockRestore?.();
        consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnMock?.mockRestore?.();
    });

    it('sets smallUrl after finalize uses the prepared binding', async () => {
        headObjectMock
            .mockResolvedValueOnce({ contentLength: 100 })
            .mockResolvedValueOnce({ contentLength: 10 });
        invokeMock.mockResolvedValue({ ok: true });

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(insertValuesCalls[0]).toEqual(
            expect.objectContaining({
                recipeId: 1,
                imageId: 2,
                authorId: 30
            })
        );
        expect(updateSetCalls).toHaveLength(2);
        expect(updateSetCalls[0]).toEqual(
            expect.objectContaining({
                fullSizeUrl: '/assets/images/original/authors/foo/recipes/img.jpg',
                originalFileSize: 100,
                finalizedAt: expect.any(Date)
            })
        );
        expect(updateSetCalls[1]).toEqual({ smallUrl: '/assets/images/600/authors/foo/recipes/img.jpg' });
        expect(result.resizeAttempted).toBe(true);
        expect(result.resizeSucceeded).toBe(true);
        expect(result.resizeSkipped).toBe(false);
    });

    it('rejects finalize when uploads are disabled', async () => {
        process.env.NEXT_PUBLIC_DISABLE_UPLOADS = 'true';

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Uploads are disabled right now.'
        });
        expect(selectMock).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        expect(headObjectMock).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('rejects finalize for another user\'s prepared image', async () => {
        requireUserMock.mockResolvedValueOnce({
            user: {
                id: 99,
                email: 'intruder@example.com'
            }
        });

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Not authorized'
        });
        expect(headObjectMock).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        expect(updateSetCalls).toHaveLength(0);
        expect(insertValuesCalls).toHaveLength(0);
    });

    it('ignores tampered recipe and object identifiers from the caller', async () => {
        selectedImageRow.smallUrl = '/assets/images/600/authors/foo/recipes/already.jpg';
        headObjectMock.mockResolvedValueOnce({ contentLength: 100 });

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                recipeId: 999,
                authorId: 999,
                objectKey: 'authors/evil/recipes/other.jpg',
                originalFileSize: 100
            }
        });

        expect(result.ok).toBe(true);
        expect(headObjectMock).toHaveBeenCalledWith(
            expect.objectContaining({
                objectName: 'authors/foo/recipes/img.jpg'
            })
        );
        expect(insertValuesCalls[0]).toEqual(
            expect.objectContaining({
                recipeId: 1,
                imageId: 2,
                authorId: 30
            })
        );
        expect(invokeMock).not.toHaveBeenCalled();
        expect(updateSetCalls).toHaveLength(1);
        expect(result.resizeAttempted).toBe(false);
        expect(result.resizeSucceeded).toBe(true);
        expect(result.resizeSkipped).toBe(true);
    });

    it('rejects finalize when the prepared upload is missing from storage', async () => {
        headObjectMock.mockRejectedValueOnce(new Error('missing'));

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Upload not found in storage');
        expect(transactionMock).not.toHaveBeenCalled();
        expect(updateSetCalls).toHaveLength(0);
        expect(insertValuesCalls).toHaveLength(0);
    });

    it('rejects finalize on object size mismatch using the prepared binding', async () => {
        headObjectMock.mockResolvedValueOnce({ contentLength: 999 });

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result).toEqual({
            ok: false,
            error: 'Uploaded object size mismatch (expected 100, got 999)'
        });
        expect(transactionMock).not.toHaveBeenCalled();
        expect(updateSetCalls).toHaveLength(0);
        expect(insertValuesCalls).toHaveLength(0);
    });

    it('continues when resize invoke fails after finalize succeeds', async () => {
        headObjectMock.mockResolvedValueOnce({ contentLength: 100 });
        invokeMock.mockRejectedValue(new Error('invoke-failed'));

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result.ok).toBe(true);
        expect(result.resizeAttempted).toBe(true);
        expect(result.resizeSucceeded).toBe(false);
        expect(result.resizeSkipped).toBe(false);
        expect(transactionMock).not.toHaveBeenCalled();
        expect(updateSetCalls).toHaveLength(1);
        expect(consoleWarnMock).toHaveBeenCalledTimes(1);
        expect(consoleWarnMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                imageId: 2,
                recipeId: 1,
                authorId: 30,
                objectKey: 'authors/foo/recipes/img.jpg'
            })
        );
    });

    it('treats timeouts as graceful resize failures after finalize succeeds', async () => {
        headObjectMock.mockResolvedValueOnce({ contentLength: 100 });
        invokeMock.mockRejectedValue(new ResizeTimeoutError(1));

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                originalFileSize: 100
            }
        });

        expect(result.ok).toBe(true);
        expect(result.resizeAttempted).toBe(true);
        expect(result.resizeSucceeded).toBe(false);
        expect(result.resizeSkipped).toBe(false);
        expect(updateSetCalls).toHaveLength(1);
        expect(consoleWarnMock).toHaveBeenCalledTimes(1);
    });

    it('returns the existing finalized result without rebinding on retry', async () => {
        selectedImageRow.finalizedAt = new Date('2026-04-08T12:00:00Z');
        selectedImageRow.fullSizeUrl = '/assets/images/original/authors/foo/recipes/img.jpg';
        selectedImageRow.smallUrl = '/assets/images/600/authors/foo/recipes/img.jpg';

        const result = await finalizeRecipeUploadAction({
            parameters: {
                imageId: 2,
                recipeId: 999,
                authorId: 999,
                objectKey: 'authors/evil/recipes/other.jpg',
                originalFileSize: 100
            }
        });

        expect(result).toEqual({
            ok: true,
            fullSizeUrl: '/assets/images/original/authors/foo/recipes/img.jpg',
            resizeAttempted: false,
            resizeSucceeded: true,
            resizeSkipped: true
        });
        expect(headObjectMock).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        expect(insertValuesCalls).toHaveLength(1);
        expect(insertValuesCalls[0]).toEqual(
            expect.objectContaining({
                recipeId: 1,
                imageId: 2,
                authorId: 30
            })
        );
        expect(updateSetCalls).toHaveLength(0);
    });
});
