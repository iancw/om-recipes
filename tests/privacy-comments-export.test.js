import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let updateMock;
let putPrivacyArtifactMock;
let getCommentsPostedByAuthorsMock;
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

// Same zip-entry extraction helper as tests/privacy-notifications.test.js.
function readZipEntryJson(buffer, entryName) {
    const nameBuffer = Buffer.from(entryName, 'utf8');
    const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    let searchOffset = 0;

    while (searchOffset < buffer.length) {
        const headerOffset = buffer.indexOf(signature, searchOffset);
        if (headerOffset === -1) throw new Error(`Zip entry "${entryName}" not found`);

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
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('../lib/privacy-artifacts.js', () => ({
    buildPrivacyArtifactKey: vi.fn(() => 'user-uuid/privacy-export-1.zip'),
    putPrivacyArtifact: (...args) => putPrivacyArtifactMock(...args),
    getPrivacyArtifact: vi.fn(),
    deletePrivacyArtifact: vi.fn(async () => {})
}));

vi.mock('../lib/comments.js', () => ({
    getCommentsPostedByAuthors: (...args) => getCommentsPostedByAuthorsMock(...args)
}));

describe('privacy export includes posted comments', () => {
    beforeEach(() => {
        vi.resetModules();
        selectHandlers = [];

        selectMock = vi.fn(() => {
            if (selectHandlers.length === 0) throw new Error('Unexpected select call');
            return selectHandlers.shift()();
        });

        insertMock = vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() =>
                    Promise.resolve([{ id: 1, userId: 5, subjectUserUuid: 'user-uuid', requestType: 'export' }])
                )
            }))
        }));

        updateMock = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }));

        putPrivacyArtifactMock = vi.fn(async () => {});
        getCommentsPostedByAuthorsMock = vi.fn(() =>
            Promise.resolve([
                {
                    recipeId: 42,
                    recipeSlug: 'great-recipe',
                    recipeName: 'Great Recipe',
                    body: 'Beautiful tones',
                    createdAt: new Date('2026-08-20T00:00:00Z')
                }
            ])
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('includes postedComments in the export payload for a user with an author record', async () => {
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
            () => makeSelectChain([{ id: 1, uuid: 'author-uuid', name: 'Ian' }]), // authors (non-empty: authorIds = [1])
            () => makeSelectChain([]), // recipeRows (authorIds non-empty, no authored recipes)
            () => makeSelectChain([]), // imageRows (authorIds non-empty, no uploaded images -> imageIds = [])
            () => makeSelectChain([]), // savedRows
            () => makeSelectChain([]), // modeAssignmentRows
            () => makeSelectChain([]), // notificationRows
            () => makeSelectChain([]) // notificationPreferenceRows
        );

        await startPrivacyExport({ userId: 5, userUuid: 'user-uuid' });

        expect(getCommentsPostedByAuthorsMock).toHaveBeenCalledWith([1]);

        const [{ buffer }] = putPrivacyArtifactMock.mock.calls[0];
        const payload = readZipEntryJson(buffer, 'account.json');

        expect(payload.postedComments).toEqual([
            {
                recipeId: 42,
                recipeSlug: 'great-recipe',
                recipeName: 'Great Recipe',
                body: 'Beautiful tones',
                createdAt: '2026-08-20T00:00:00.000Z'
            }
        ]);
    });
});
