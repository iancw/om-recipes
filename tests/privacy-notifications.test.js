import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let updateMock;
let deleteMock;
let putPrivacyArtifactMock;

let selectHandlers = [];

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

// Extracts the first stored (uncompressed) zip entry's raw bytes by name.
// createZipArchive (lib/zip.js) always writes entries with compression
// method 0 (store), so the entry's data bytes sit unmodified right after
// its local file header + file name in the buffer.
function readZipEntryJson(buffer, entryName) {
    const nameBuffer = Buffer.from(entryName, 'utf8');
    const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    let searchOffset = 0;

    while (searchOffset < buffer.length) {
        const headerOffset = buffer.indexOf(signature, searchOffset);
        if (headerOffset === -1) {
            throw new Error(`Zip entry "${entryName}" not found`);
        }

        const nameLength = buffer.readUInt16LE(headerOffset + 26);
        const dataLength = buffer.readUInt32LE(headerOffset + 18);
        const candidateName = buffer.slice(headerOffset + 30, headerOffset + 30 + nameLength).toString('utf8');

        if (candidateName === entryName) {
            const dataStart = headerOffset + 30 + nameLength;
            const dataBuffer = buffer.slice(dataStart, dataStart + dataLength);
            return JSON.parse(dataBuffer.toString('utf8'));
        }

        searchOffset = headerOffset + 4;
    }

    throw new Error(`Zip entry "${entryName}" not found`);
}

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        update: (...args) => updateMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

vi.mock('../lib/privacy-artifacts.js', () => ({
    buildPrivacyArtifactKey: vi.fn(() => 'user-uuid/privacy-export-1.zip'),
    putPrivacyArtifact: (...args) => putPrivacyArtifactMock(...args),
    getPrivacyArtifact: vi.fn(),
    deletePrivacyArtifact: vi.fn(async () => {})
}));

describe('privacy retention prunes old notifications', () => {
    beforeEach(async () => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('deletes notifications older than the retention cutoff', async () => {
        const deletedRows = { notifications: [{ id: 1 }, { id: 2 }] };
        // db.delete(...) call order inside runPrivacyRetentionCleanup:
        //   1. authMagicLinks
        //   2. authSessions
        //   3. notifications          <- new, inserted right after authSessions
        //   4. privacyRequests
        //   5. images (conditional on abandonedUploads.length > 0; skipped here since
        //      the abandonedUploads select below returns [])
        const returningByCall = [
            [], // authMagicLinks
            [], // authSessions
            deletedRows.notifications, // notifications
            [] // privacyRequests
        ];
        let call = 0;
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([]))
        }));
        deleteMock = vi.fn(() => ({
            where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve(returningByCall[call++] ?? []))
            }))
        }));

        const { runPrivacyRetentionCleanup } = await import('../lib/privacy.js');
        const summary = await runPrivacyRetentionCleanup({ now: new Date('2026-08-21T00:00:00Z'), env: {} });

        expect(summary.deletedNotifications).toBe(2);
        expect(summary.deletedMagicLinks).toBe(0);
        expect(summary.deletedSessions).toBe(0);
        expect(summary.deletedPrivacyRequests).toBe(0);
        expect(summary.deletedAbandonedUploads).toBe(0);
    });
});

describe('privacy export includes notifications', () => {
    beforeEach(() => {
        vi.resetModules();
        selectHandlers = [];

        selectMock = vi.fn(() => {
            if (selectHandlers.length === 0) {
                throw new Error('Unexpected select call');
            }
            return selectHandlers.shift()();
        });

        insertMock = vi.fn(() => ({
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

        updateMock = vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve())
            }))
        }));

        putPrivacyArtifactMock = vi.fn(async () => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('includes receivedNotifications and notificationPreferences in the export payload', async () => {
        const { startPrivacyExport } = await import('../lib/privacy.js');

        selectHandlers.push(
            () => makeSelectChain([]), // createPrivacyRequest: existing in-flight request check
            () =>
                makeSelectChain([
                    {
                        id: 5,
                        uuid: 'user-uuid',
                        email: 'ian@example.com',
                        emailVerifiedAt: null,
                        createdAt: new Date('2026-04-01T00:00:00Z'),
                        updatedAt: new Date('2026-04-01T00:00:00Z')
                    }
                ]), // users
            () => makeSelectChain([]), // authors (none, keeps images/uploads out of scope)
            () => makeSelectChain([]), // savedRows
            () => makeSelectChain([]), // modeAssignmentRows
            () =>
                makeSelectChain([
                    {
                        type: 'new_recipe',
                        recipeId: 42,
                        recipeSlug: 'great-recipe',
                        recipeName: 'Great Recipe',
                        readAt: null,
                        createdAt: new Date('2026-08-01T00:00:00Z')
                    }
                ]), // notificationRows
            () =>
                makeSelectChain([
                    {
                        notifyNewRecipe: true,
                        notifySampleImage: true,
                        notifySave: false,
                        emailDigestEnabled: true
                    }
                ]) // notificationPreferenceRows
        );

        await startPrivacyExport({ userId: 5, userUuid: 'user-uuid' });

        expect(putPrivacyArtifactMock).toHaveBeenCalledTimes(1);
        const [{ buffer }] = putPrivacyArtifactMock.mock.calls[0];
        const payload = readZipEntryJson(buffer, 'account.json');

        expect(payload.receivedNotifications).toEqual([
            {
                type: 'new_recipe',
                recipeId: 42,
                recipeSlug: 'great-recipe',
                recipeName: 'Great Recipe',
                readAt: null,
                createdAt: '2026-08-01T00:00:00.000Z'
            }
        ]);
        expect(payload.notificationPreferences).toEqual({
            notifyNewRecipe: true,
            notifySampleImage: true,
            notifySave: false,
            emailDigestEnabled: true
        });
    });

    it('exports notificationPreferences as null when the user has no preferences row', async () => {
        const { startPrivacyExport } = await import('../lib/privacy.js');

        selectHandlers.push(
            () => makeSelectChain([]), // createPrivacyRequest: existing in-flight request check
            () =>
                makeSelectChain([
                    {
                        id: 5,
                        uuid: 'user-uuid',
                        email: 'ian@example.com',
                        emailVerifiedAt: null,
                        createdAt: new Date('2026-04-01T00:00:00Z'),
                        updatedAt: new Date('2026-04-01T00:00:00Z')
                    }
                ]), // users
            () => makeSelectChain([]), // authors
            () => makeSelectChain([]), // savedRows
            () => makeSelectChain([]), // modeAssignmentRows
            () => makeSelectChain([]), // notificationRows
            () => makeSelectChain([]) // notificationPreferenceRows (none)
        );

        await startPrivacyExport({ userId: 5, userUuid: 'user-uuid' });

        const [{ buffer }] = putPrivacyArtifactMock.mock.calls[0];
        const payload = readZipEntryJson(buffer, 'account.json');

        expect(payload.receivedNotifications).toEqual([]);
        expect(payload.notificationPreferences).toBeNull();
    });
});
