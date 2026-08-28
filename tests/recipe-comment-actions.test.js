import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let addCommentAction;
let deleteCommentAction;

let selectMock;
let revalidatePathMock;
let addCommentMock;
let deleteCommentMock;
let notifyRecipeCommentedMock;
let findOrCreateAuthorForUserMock;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'user@example.com' } }),
    findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args)
}));

vi.mock('../lib/comments.js', () => ({
    addComment: (...args) => addCommentMock(...args),
    deleteComment: (...args) => deleteCommentMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeCommented: (...args) => notifyRecipeCommentedMock(...args)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

describe('addCommentAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        revalidatePathMock = vi.fn();
        addCommentMock = vi.fn(() => Promise.resolve({ id: 55, uuid: 'comment-uuid', createdAt: new Date('2026-08-26') }));
        notifyRecipeCommentedMock = vi.fn(() => Promise.resolve());
        findOrCreateAuthorForUserMock = vi.fn(() => Promise.resolve({ id: 2, uuid: 'author-uuid', name: 'Commenter' }));

        const recipeSelectResponses = [[{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug' }]];
        selectMock = vi.fn(() => {
            const res = recipeSelectResponses.shift() ?? [];
            return {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn(() => Promise.resolve(res))
            };
        });

        const mod = await import('../app/recipes/[id]/actions.js');
        addCommentAction = mod.addCommentAction;
        deleteCommentAction = mod.deleteCommentAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves the author, adds the comment, notifies the owner, and revalidates', async () => {
        const result = await addCommentAction({ recipeId: 123, body: 'Nice recipe!' });

        expect(result).toEqual({ ok: true });
        expect(findOrCreateAuthorForUserMock).toHaveBeenCalledWith({ userId: 9, email: 'user@example.com' });
        expect(addCommentMock).toHaveBeenCalledWith({ recipeId: 123, authorId: 2, body: 'Nice recipe!' });
        expect(notifyRecipeCommentedMock).toHaveBeenCalledWith(123, 55, 2);
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/recipe-slug');
    });

    it('rejects a non-numeric recipe id', async () => {
        await expect(addCommentAction({ recipeId: 'nope', body: 'Hi' })).rejects.toThrow('Invalid recipe id');
        expect(addCommentMock).not.toHaveBeenCalled();
    });

    it('returns the validation message as data instead of throwing', async () => {
        // Next.js redacts thrown Server Action error messages in production, so
        // expected user-facing failures (cooldown, blank/over-length body) must
        // come back as a value the client can render verbatim.
        addCommentMock = vi.fn(() => Promise.reject(new Error('Please wait a moment before posting another comment')));

        const result = await addCommentAction({ recipeId: 123, body: 'Too soon!' });

        expect(result).toEqual({ ok: false, error: 'Please wait a moment before posting another comment' });
        expect(notifyRecipeCommentedMock).not.toHaveBeenCalled();
        expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it('still throws when the recipe does not exist', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([]))
        }));

        await expect(addCommentAction({ recipeId: 123, body: 'Hi' })).rejects.toThrow('Recipe not found');
        expect(addCommentMock).not.toHaveBeenCalled();
    });
});

describe('deleteCommentAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        revalidatePathMock = vi.fn();
        deleteCommentMock = vi.fn(() => Promise.resolve());

        // Chain must support BOTH `.where().limit(1)` (recipe lookup, comment lookup)
        // and a bare `.where()` awaited directly (author lookup, no .limit call) —
        // `where` returns the same chainable+thenable object either way.
        const selectResponses = [
            [{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug', authorId: 1 }], // recipe lookup
            [{ recipeId: 123 }], // comment lookup - belongs to this recipe
            [{ id: 2 }] // requester's author rows
        ];
        selectMock = vi.fn(() => {
            const res = selectResponses.shift() ?? [];
            return {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn(() => Promise.resolve(res)),
                then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
            };
        });

        const mod = await import('../app/recipes/[id]/actions.js');
        deleteCommentAction = mod.deleteCommentAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves the requester author ids and deletes via lib/comments.js', async () => {
        await deleteCommentAction({ recipeId: 123, commentId: 55 });

        expect(deleteCommentMock).toHaveBeenCalledWith({ commentId: 55, requestingAuthorIds: [2], recipeAuthorId: 1 });
        expect(revalidatePathMock).toHaveBeenCalledWith('/recipes/recipe-slug');
    });

    it('rejects when the comment does not belong to the supplied recipe', async () => {
        // Recipe lookup succeeds (recipeId 123, owned by author 1), but the comment
        // being deleted actually belongs to a different recipe (999). A malicious
        // caller could otherwise pass any recipe they own alongside a victim's
        // comment id to smuggle their own author id through as `recipeAuthorId`.
        const mismatchResponses = [
            [{ id: 123, uuid: 'recipe-uuid', slug: 'recipe-slug', authorId: 1 }], // recipe lookup
            [{ recipeId: 999 }] // comment lookup - belongs to a different recipe
        ];
        selectMock = vi.fn(() => {
            const res = mismatchResponses.shift() ?? [];
            return {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn(() => Promise.resolve(res)),
                then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
            };
        });

        await expect(deleteCommentAction({ recipeId: 123, commentId: 55 })).rejects.toThrow('Comment not found');
        expect(deleteCommentMock).not.toHaveBeenCalled();
    });
});
