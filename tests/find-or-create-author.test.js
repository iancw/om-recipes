import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let findOrCreateAuthorForUser;

let selectMock;
let insertMock;
let selectResponses;
let insertResponses;
let insertValuesMock;

vi.mock('next/headers', () => ({
    cookies: () => Promise.resolve({ get: vi.fn(), set: vi.fn() })
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

function makeSelectChain(result) {
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(() => Promise.resolve(result))
    };
}

function makeInsertChain(returningResult) {
    insertValuesMock = vi.fn().mockReturnThis();
    return {
        values: insertValuesMock,
        returning: vi.fn(() => Promise.resolve(returningResult))
    };
}

describe('lib/auth.js findOrCreateAuthorForUser', () => {
    beforeEach(async () => {
        selectResponses = [];
        insertResponses = [];
        selectMock = vi.fn(() => makeSelectChain(selectResponses.shift() ?? []));
        insertMock = vi.fn(() => makeInsertChain(insertResponses.shift()));

        vi.resetModules();
        const mod = await import('../lib/auth.js');
        findOrCreateAuthorForUser = mod.findOrCreateAuthorForUser;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the existing author without checking user existence or inserting, when an author row already exists', async () => {
        selectResponses = [[{ id: 5, uuid: 'author-uuid', name: 'Existing Author' }]];

        const result = await findOrCreateAuthorForUser({ userId: 42, email: 'user@example.com', displayName: 'User' });

        expect(result).toEqual({ id: 5, uuid: 'author-uuid', name: 'Existing Author' });
        expect(selectMock).toHaveBeenCalledTimes(1);
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('creates and returns a new author when the user exists and has no author row yet', async () => {
        selectResponses = [
            [], // no existing author
            [{ id: 99 }] // user exists
        ];
        insertResponses = [[{ id: 7, uuid: 'new-author-uuid', name: 'New Author' }]];

        const result = await findOrCreateAuthorForUser({ userId: 99, email: 'new@example.com', displayName: 'New Author' });

        expect(result).toEqual({ id: 7, uuid: 'new-author-uuid', name: 'New Author' });
        expect(selectMock).toHaveBeenCalledTimes(2);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(insertValuesMock).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 99, name: 'New Author' })
        );
    });

    it('throws a clean error and does not insert when the user no longer exists (ghost session)', async () => {
        selectResponses = [
            [], // no existing author
            [] // user does not exist
        ];

        await expect(
            findOrCreateAuthorForUser({ userId: 404, email: 'ghost@example.com', displayName: 'Ghost' })
        ).rejects.toThrow('Your account no longer exists. Please sign in again.');

        expect(selectMock).toHaveBeenCalledTimes(2);
        expect(insertMock).not.toHaveBeenCalled();
    });
});
