import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let notifyRecipeCommented;
let commentDedupeKey;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

function selectSequence(responses) {
    const queue = [...responses];
    return vi.fn(() => {
        const res = queue.shift() ?? [];
        return {
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve(res)),
            then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
    });
}

function insertRecorder() {
    const onConflictDoNothing = vi.fn(() => Promise.resolve());
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    return { insert, values, onConflictDoNothing };
}

describe('notifyRecipeCommented', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        notifyRecipeCommented = mod.notifyRecipeCommented;
        commentDedupeKey = mod.commentDedupeKey;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds the dedupe key format', () => {
        expect(commentDedupeKey(77)).toBe('comment:77');
    });

    it('skips when the commenter is the recipe owner', async () => {
        selectMock = selectSequence([[{ authorId: 1, ownerUserId: 9 }]]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 1);

        expect(rec.insert).not.toHaveBeenCalled();
    });

    it('skips when the owner has notifyComment off', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9 }],
            [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: false, emailDigestEnabled: true }]
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.insert).not.toHaveBeenCalled();
    });

    it('inserts an idempotent row when a different author comments', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9 }],
            [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: true, emailDigestEnabled: true }]
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.values).toHaveBeenCalledWith(
            expect.objectContaining({
                recipientUserId: 9,
                type: 'comment',
                recipeId: 5,
                actorAuthorId: 2,
                dedupeKey: 'comment:77'
            })
        );
        expect(rec.onConflictDoNothing).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the recipe has no notifiable owner', async () => {
        selectMock = selectSequence([[]]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.insert).not.toHaveBeenCalled();
    });
});
