import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let updateMock;
let deleteMock;
let deleteImagesByIdsMock;
let putPrivacyArtifactMock;
let deletePrivacyArtifactMock;

let selectHandlers = [];
let insertHandlers = [];
let updateHandlers = [];
let deleteHandlers = [];

function makeSelectChain(result) {
    const promise = Promise.resolve(result);
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        limit: vi.fn(() => promise),
        then: promise.then.bind(promise)
    };
}

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

vi.mock('../lib/oci/deleteOrphanedImages.js', () => ({
    deleteImagesByIds: (...args) => deleteImagesByIdsMock(...args)
}));

vi.mock('../lib/privacy-artifacts.js', () => ({
    buildPrivacyArtifactKey: vi.fn(() => 'user-uuid/privacy-export-1.zip'),
    putPrivacyArtifact: (...args) => putPrivacyArtifactMock(...args),
    getPrivacyArtifact: vi.fn(),
    deletePrivacyArtifact: (...args) => deletePrivacyArtifactMock(...args)
}));

describe('privacy workflows', () => {
    beforeEach(() => {
        vi.resetModules();

        selectHandlers = [];
        insertHandlers = [];
        updateHandlers = [];
        deleteHandlers = [];

        selectMock = vi.fn(() => {
            if (selectHandlers.length === 0) {
                throw new Error('Unexpected select call');
            }
            return selectHandlers.shift()();
        });

        insertMock = vi.fn(() => {
            if (insertHandlers.length === 0) {
                throw new Error('Unexpected insert call');
            }
            return insertHandlers.shift()();
        });

        updateMock = vi.fn(() => {
            if (updateHandlers.length === 0) {
                throw new Error('Unexpected update call');
            }
            return updateHandlers.shift()();
        });

        deleteMock = vi.fn(() => {
            if (deleteHandlers.length === 0) {
                throw new Error('Unexpected delete call');
            }
            return deleteHandlers.shift()();
        });

        deleteImagesByIdsMock = vi.fn(async () => [700, 701]);
        putPrivacyArtifactMock = vi.fn(async () => {});
        deletePrivacyArtifactMock = vi.fn(async () => {});
    });

    it('creates and completes a privacy export request', async () => {
        const { startPrivacyExport } = await import('../lib/privacy.js');

        selectHandlers.push(
            () => makeSelectChain([]),
            () => makeSelectChain([
                {
                    id: 5,
                    uuid: 'user-uuid',
                    email: 'ian@example.com',
                    emailVerifiedAt: null,
                    createdAt: new Date('2026-04-01T00:00:00Z'),
                    updatedAt: new Date('2026-04-01T00:00:00Z')
                }
            ]),
            () => makeSelectChain([]),
            () => makeSelectChain([]),
            () => makeSelectChain([]),
            () => makeSelectChain([]),
            () => makeSelectChain([]),
            () => makeSelectChain([])
        );

        insertHandlers.push(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() =>
                    Promise.resolve([
                        {
                            id: 1,
                            userId: 5,
                            subjectUserUuid: 'user-uuid',
                            requestType: 'export'
                        }
                    ])
                )
            }))
        }));

        updateHandlers.push(
            () => ({
                set: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve())
                }))
            }),
            () => ({
                set: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve())
                }))
            })
        );

        const requestId = await startPrivacyExport({
            userId: 5,
            userUuid: 'user-uuid'
        });

        expect(requestId).toBe(1);
        expect(putPrivacyArtifactMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(2);
    });

    it('deletes owned images and account rows during account erasure', async () => {
        const { startAccountDeletion } = await import('../lib/privacy.js');

        selectHandlers.push(
            () => makeSelectChain([]),
            () => makeSelectChain([{ id: 88 }]),
            () => makeSelectChain([{ id: 700 }, { id: 701 }])
        );

        insertHandlers.push(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() =>
                    Promise.resolve([
                        {
                            id: 2,
                            userId: 5,
                            subjectUserUuid: 'user-uuid',
                            requestType: 'delete_account'
                        }
                    ])
                )
            }))
        }));

        updateHandlers.push(
            () => ({
                set: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve())
                }))
            }),
            () => ({
                set: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve())
                }))
            })
        );

        deleteHandlers.push(
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) }),
            () => ({ where: vi.fn(() => Promise.resolve()) })
        );

        await startAccountDeletion({
            userId: 5,
            userUuid: 'user-uuid'
        });

        expect(deleteImagesByIdsMock).toHaveBeenCalledWith([700, 701]);
        expect(deleteMock).toHaveBeenCalledTimes(5);
        expect(updateMock).toHaveBeenCalledTimes(2);
    });

    it('clears expired export artifacts and abandoned uploads during retention cleanup', async () => {
        const { runPrivacyRetentionCleanup } = await import('../lib/privacy.js');

        selectHandlers.push(
            () => makeSelectChain([{ id: 10, artifactKey: 'user-uuid/privacy-export-1.zip' }]),
            () => makeSelectChain([{ id: 88, preparedObjectKey: 'authors/a/prepared.jpg' }])
        );

        updateHandlers.push(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve())
            }))
        }));

        deleteHandlers.push(
            () => ({
                where: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([{ id: 1 }]))
                }))
            }),
            () => ({
                where: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([{ id: 2 }]))
                }))
            }),
            () => ({
                where: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([{ id: 3 }]))
                }))
            }),
            () => ({ where: vi.fn(() => Promise.resolve()) })
        );

        const summary = await runPrivacyRetentionCleanup({
            now: new Date('2026-04-24T00:00:00Z'),
            env: {}
        });

        expect(deletePrivacyArtifactMock).toHaveBeenCalledWith({ key: 'user-uuid/privacy-export-1.zip' });
        expect(summary).toEqual({
            deletedMagicLinks: 1,
            deletedSessions: 1,
            expiredExportArtifactsCleared: 1,
            deletedPrivacyRequests: 1,
            deletedAbandonedUploads: 1
        });
    });
});
