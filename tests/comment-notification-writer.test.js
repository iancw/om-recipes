import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let notifyRecipeCommented;
let commentDedupeKey;
let commentParticipantDedupeKey;
let appendNotificationToUserStateMock;
let getRecipeIndexMock;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

vi.mock('../lib/user-state-cache.js', () => ({
    appendNotificationToUserState: (...args) => appendNotificationToUserStateMock(...args),
    getUserSavedState: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    getRecipeIndex: (...args) => getRecipeIndexMock(...args)
}));

function selectSequence(responses) {
    const queue = [...responses];
    return vi.fn(() => {
        const res = queue.shift() ?? [];
        return {
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
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
        appendNotificationToUserStateMock = vi.fn(() => Promise.resolve(true));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 5, slug: 'golden-hour', recipeName: 'Golden Hour' }]));
        const mod = await import('../lib/notifications.js');
        notifyRecipeCommented = mod.notifyRecipeCommented;
        commentDedupeKey = mod.commentDedupeKey;
        commentParticipantDedupeKey = mod.commentParticipantDedupeKey;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds the dedupe key formats', () => {
        expect(commentDedupeKey(77)).toBe('comment:77');
        expect(commentParticipantDedupeKey(77, 3)).toBe('comment:77:3');
    });

    it('does nothing when the recipe has no notifiable owner', async () => {
        selectMock = selectSequence([[]]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.insert).not.toHaveBeenCalled();
        expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
    });

    it('skips the owner notification when the commenter is the recipe owner', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }], // getRecipeOwner
            [{ userId: 9 }], // commenter user id
            [{ userId: 9 }] // comment participants (only the owner so far)
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 1);

        expect(rec.insert).not.toHaveBeenCalled();
        expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
    });

    it('skips the owner notification when the owner has notifyComment off', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }],
            [{ userId: 2 }],
            [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: false, emailDigestEnabled: true }],
            [] // no other participants
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.insert).not.toHaveBeenCalled();
        expect(appendNotificationToUserStateMock).not.toHaveBeenCalled();
    });

    it('inserts an idempotent owner row and cache-appends when a different author comments', async () => {
        // Select call order: getRecipeOwner, getAuthorUserId (commenter), owner
        // prefs, then — after the owner insert — the actor-name lookup inside
        // Promise.all([resolveMeta(), resolveActorName()]), and only then
        // getCommentParticipantUserIds (which finds none here).
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }],
            [{ userId: 2 }],
            [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: true, emailDigestEnabled: true }],
            [{ name: 'Jordan' }],
            [] // no other participants
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.values).toHaveBeenCalledTimes(1);
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
        expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('owner-uuid', 9, {
            type: 'comment',
            recipeId: 5,
            recipeSlug: 'golden-hour',
            recipeName: 'Golden Hour',
            actorAuthorName: 'Jordan',
            sampleImageId: null,
            dedupeKey: 'comment:77'
        });
    });

    it('notifies thread participants who are not the owner or the commenter', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }], // getRecipeOwner
            [{ userId: 20 }], // commenter user id
            [{ notifyNewRecipe: false, notifySampleImage: true, notifySave: true, notifyComment: true, emailDigestEnabled: true }], // owner prefs
            [{ name: 'Jordan' }], // commenter author name (resolved once, right after the owner insert; memoized for reuse below)
            [{ userId: 9 }, { userId: 20 }, { userId: 30 }, { userId: 40 }], // comment participants
            [
                { userId: 30, notifyComment: true },
                { userId: 40, notifyComment: false }
            ], // participant prefs
            [{ id: 30, uuid: 'uuid-30' }] // uuid for participant 30
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 2);

        expect(rec.values).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ recipientUserId: 9, dedupeKey: 'comment:77' })
        );
        expect(rec.values).toHaveBeenNthCalledWith(2, [
            expect.objectContaining({
                recipientUserId: 30,
                type: 'comment',
                recipeId: 5,
                actorAuthorId: 2,
                dedupeKey: 'comment:77:30'
            })
        ]);
        expect(rec.onConflictDoNothing).toHaveBeenCalledTimes(2);
        expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('owner-uuid', 9, expect.objectContaining({ dedupeKey: 'comment:77' }));
        expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('uuid-30', 30, expect.objectContaining({ dedupeKey: 'comment:77:30' }));
    });

    it('notifies a participant who has no preference row (defaults on)', async () => {
        selectMock = selectSequence([
            [{ authorId: 1, ownerUserId: 9, ownerUuid: 'owner-uuid' }], // getRecipeOwner
            [{ userId: 9 }], // commenter is the owner
            [{ userId: 9 }, { userId: 55 }], // comment participants
            [], // no preference rows -> default notifyComment
            [{ name: 'Owner Author' }], // commenter (owner) author name
            [{ id: 55, uuid: 'uuid-55' }] // uuid for participant 55
        ]);
        const rec = insertRecorder();
        insertMock = rec.insert;

        await notifyRecipeCommented(5, 77, 1);

        expect(rec.values).toHaveBeenCalledTimes(1);
        expect(rec.values).toHaveBeenCalledWith([
            expect.objectContaining({
                recipientUserId: 55,
                type: 'comment',
                recipeId: 5,
                actorAuthorId: 1,
                dedupeKey: 'comment:77:55'
            })
        ]);
        expect(rec.onConflictDoNothing).toHaveBeenCalledTimes(1);
        expect(appendNotificationToUserStateMock).toHaveBeenCalledWith('uuid-55', 55, expect.objectContaining({ dedupeKey: 'comment:77:55' }));
    });
});
