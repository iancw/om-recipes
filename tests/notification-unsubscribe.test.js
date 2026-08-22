import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let buildUnsubscribeToken;
let verifyUnsubscribeToken;
let unsubscribeFromEmailDigest;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

describe('unsubscribe token', () => {
    beforeEach(async () => {
        vi.resetModules();
        process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET = 'test-secret';
        const mod = await import('../lib/notifications.js');
        buildUnsubscribeToken = mod.buildUnsubscribeToken;
        verifyUnsubscribeToken = mod.verifyUnsubscribeToken;
        unsubscribeFromEmailDigest = mod.unsubscribeFromEmailDigest;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    });

    it('is deterministic for the same user uuid', () => {
        const a = buildUnsubscribeToken('user-uuid-1');
        const b = buildUnsubscribeToken('user-uuid-1');
        expect(a).toBe(b);
    });

    it('differs for different user uuids', () => {
        expect(buildUnsubscribeToken('user-uuid-1')).not.toBe(buildUnsubscribeToken('user-uuid-2'));
    });

    it('verifies a valid token and rejects an invalid one', () => {
        const token = buildUnsubscribeToken('user-uuid-1');
        expect(verifyUnsubscribeToken('user-uuid-1', token)).toBe(true);
        expect(verifyUnsubscribeToken('user-uuid-1', 'wrong-token')).toBe(false);
        expect(verifyUnsubscribeToken('user-uuid-1', '')).toBe(false);
    });

    it('flips emailDigestEnabled off for a valid token without requiring login', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ id: 9 }]))
        }));
        const onConflictDoUpdate = vi.fn(() => Promise.resolve());
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        insertMock = vi.fn(() => ({ values }));

        const token = buildUnsubscribeToken('user-uuid-1');
        await unsubscribeFromEmailDigest({ userUuid: 'user-uuid-1', token });

        expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, emailDigestEnabled: false }));
    });

    it('rejects an invalid token', async () => {
        await expect(
            unsubscribeFromEmailDigest({ userUuid: 'user-uuid-1', token: 'wrong' })
        ).rejects.toThrow('Invalid or expired unsubscribe link');
    });
});
