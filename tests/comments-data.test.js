import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let deleteMock;
let getCommentsForRecipe;
let addComment;
let deleteComment;
let getCommentsPostedByAuthors;
let COMMENT_MAX_LENGTH;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

function selectSequence(responses) {
    const queue = [...responses];
    return vi.fn(() => {
        const res = queue.shift() ?? [];
        return {
            from: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(res)),
            then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
    });
}

describe('lib/comments.js', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/comments.js');
        getCommentsForRecipe = mod.getCommentsForRecipe;
        addComment = mod.addComment;
        deleteComment = mod.deleteComment;
        getCommentsPostedByAuthors = mod.getCommentsPostedByAuthors;
        COMMENT_MAX_LENGTH = mod.COMMENT_MAX_LENGTH;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getCommentsForRecipe', () => {
        it('returns comments oldest-first with the author name joined in', async () => {
            selectMock = selectSequence([
                [{ id: 1, uuid: 'c-uuid', body: 'Nice recipe', createdAt: new Date('2026-08-01'), authorId: 3, authorName: 'Jane' }]
            ]);

            const rows = await getCommentsForRecipe(42);

            expect(rows).toEqual([
                { id: 1, uuid: 'c-uuid', body: 'Nice recipe', createdAt: new Date('2026-08-01'), authorId: 3, authorName: 'Jane' }
            ]);
        });
    });

    describe('addComment', () => {
        it('rejects a blank body', async () => {
            await expect(addComment({ recipeId: 1, authorId: 2, body: '   ' })).rejects.toThrow('Comment cannot be empty');
        });

        it('rejects a body over the max length', async () => {
            const tooLong = 'a'.repeat(COMMENT_MAX_LENGTH + 1);
            await expect(addComment({ recipeId: 1, authorId: 2, body: tooLong })).rejects.toThrow(/2000 characters/);
        });

        it('rejects a second comment within the cooldown window', async () => {
            selectMock = selectSequence([[{ id: 99 }]]); // cooldown check finds a recent comment

            await expect(addComment({ recipeId: 1, authorId: 2, body: 'Hello' })).rejects.toThrow(/wait a moment/);
        });

        it('inserts a trimmed comment when validation passes', async () => {
            selectMock = selectSequence([[]]); // cooldown check finds nothing recent
            const returning = vi.fn(() => Promise.resolve([{ id: 10, uuid: 'new-uuid', createdAt: new Date('2026-08-26') }]));
            const values = vi.fn(() => ({ returning }));
            insertMock = vi.fn(() => ({ values }));

            const result = await addComment({ recipeId: 1, authorId: 2, body: '  Great white balance!  ' });

            expect(values).toHaveBeenCalledWith({ recipeId: 1, authorId: 2, body: 'Great white balance!' });
            expect(result).toEqual({ id: 10, uuid: 'new-uuid', createdAt: new Date('2026-08-26') });
        });
    });

    describe('deleteComment', () => {
        it('throws when the comment does not exist', async () => {
            selectMock = selectSequence([[]]);

            await expect(
                deleteComment({ commentId: 5, requestingAuthorIds: [1], recipeAuthorId: 1 })
            ).rejects.toThrow('Comment not found');
        });

        it('allows the comment author to delete their own comment', async () => {
            selectMock = selectSequence([[{ id: 5, authorId: 7 }]]);
            const where = vi.fn(() => Promise.resolve());
            deleteMock = vi.fn(() => ({ where }));

            await deleteComment({ commentId: 5, requestingAuthorIds: [7], recipeAuthorId: 1 });

            expect(deleteMock).toHaveBeenCalledTimes(1);
        });

        it('allows the recipe owner to delete a comment they did not write', async () => {
            selectMock = selectSequence([[{ id: 5, authorId: 7 }]]);
            const where = vi.fn(() => Promise.resolve());
            deleteMock = vi.fn(() => ({ where }));

            await deleteComment({ commentId: 5, requestingAuthorIds: [1], recipeAuthorId: 1 });

            expect(deleteMock).toHaveBeenCalledTimes(1);
        });

        it('rejects a third party who is neither the comment author nor the recipe owner', async () => {
            selectMock = selectSequence([[{ id: 5, authorId: 7 }]]);
            deleteMock = vi.fn();

            await expect(
                deleteComment({ commentId: 5, requestingAuthorIds: [99], recipeAuthorId: 1 })
            ).rejects.toThrow('Not authorized');
            expect(deleteMock).not.toHaveBeenCalled();
        });
    });

    describe('getCommentsPostedByAuthors', () => {
        it('returns an empty array without querying when authorIds is empty', async () => {
            selectMock = vi.fn();

            const rows = await getCommentsPostedByAuthors([]);

            expect(rows).toEqual([]);
            expect(selectMock).not.toHaveBeenCalled();
        });

        it('queries comments joined to their recipe when authorIds is non-empty', async () => {
            selectMock = selectSequence([
                [{ recipeId: 1, recipeSlug: 'golden-hour', recipeName: 'Golden Hour', body: 'Love this', createdAt: new Date('2026-08-01') }]
            ]);

            const rows = await getCommentsPostedByAuthors([7]);

            expect(rows).toEqual([
                { recipeId: 1, recipeSlug: 'golden-hour', recipeName: 'Golden Hour', body: 'Love this', createdAt: new Date('2026-08-01') }
            ]);
        });
    });
});
