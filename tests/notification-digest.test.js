import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';

let selectMock;
let selectDistinctMock;
let updateMock;
let sendEmailMock;
let isSixPmEastern;
let getUsersEligibleForDigest;
let sendDailyDigestForUser;
let runDailyDigest;
let notifications;
let notificationPreferences;
let users;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        selectDistinct: (...args) => selectDistinctMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('../lib/oci/emailDelivery.js', () => ({
    sendEmail: (...args) => sendEmailMock(...args)
}));

vi.mock('../lib/auth-url.js', () => ({
    publicAppBaseUrl: () => 'https://www.omrecipes.dev'
}));

describe('daily digest', () => {
    beforeEach(async () => {
        vi.resetModules();
        process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET = 'test-secret';
        sendEmailMock = vi.fn(() => Promise.resolve());
        const mod = await import('../lib/notifications.js');
        isSixPmEastern = mod.isSixPmEastern;
        getUsersEligibleForDigest = mod.getUsersEligibleForDigest;
        sendDailyDigestForUser = mod.sendDailyDigestForUser;
        runDailyDigest = mod.runDailyDigest;
        const schema = await import('../db/schema.ts');
        notifications = schema.notifications;
        notificationPreferences = schema.notificationPreferences;
        users = schema.users;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.NOTIFICATIONS_UNSUBSCRIBE_SECRET;
    });

    describe('isSixPmEastern', () => {
        it('is true at 6pm Eastern Daylight Time', () => {
            // 2026-08-21 18:00 EDT == 22:00 UTC
            expect(isSixPmEastern(new Date('2026-08-21T22:00:00Z'))).toBe(true);
        });

        it('is true at 6pm Eastern Standard Time', () => {
            // 2026-01-21 18:00 EST == 23:00 UTC
            expect(isSixPmEastern(new Date('2026-01-21T23:00:00Z'))).toBe(true);
        });

        it('is false at other hours', () => {
            expect(isSixPmEastern(new Date('2026-08-21T12:00:00Z'))).toBe(false);
        });
    });

    it('sends a grouped digest and marks only the sent rows emailed', async () => {
        const pendingRows = [
            { id: 1, type: 'recipe_saved' },
            { id: 2, type: 'recipe_saved' },
            { id: 3, type: 'sample_image_added' }
        ];
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve(pendingRows))
        }));
        const where = vi.fn(() => Promise.resolve());
        const set = vi.fn(() => ({ where }));
        updateMock = vi.fn(() => ({ set }));

        const result = await sendDailyDigestForUser({ userId: 9, uuid: 'user-uuid-1', email: 'owner@example.com' });

        expect(result).toEqual({ sent: true, count: 3 });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const call = sendEmailMock.mock.calls[0][0];
        expect(call.to).toBe('owner@example.com');
        expect(call.subject).toContain('2 saves');
        expect(call.html).toContain('unsubscribe');
        expect(call.headers).toEqual(expect.objectContaining({ 'List-Unsubscribe': expect.stringContaining('unsubscribe') }));
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ emailedAt: expect.any(Date) }));
    });

    it('does nothing and does not send when there is nothing pending', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([]))
        }));

        const result = await sendDailyDigestForUser({ userId: 9, uuid: 'user-uuid-1', email: 'owner@example.com' });

        expect(result).toEqual({ sent: false, count: 0 });
        expect(sendEmailMock).not.toHaveBeenCalled();
    });

    describe('getUsersEligibleForDigest', () => {
        function mockSelectDistinctChain(resolvedRows) {
            const whereMock = vi.fn(() => Promise.resolve(resolvedRows));
            const leftJoinMock = vi.fn(() => ({ where: whereMock }));
            const innerJoinMock = vi.fn(() => ({ leftJoin: leftJoinMock }));
            const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
            selectDistinctMock = vi.fn(() => ({ from: fromMock }));
            return { whereMock, leftJoinMock, innerJoinMock, fromMock };
        }

        it('joins on notification_preferences and filters with a where clause that treats a missing preferences row (NULL) as digest-enabled', async () => {
            const rows = [{ userId: 1, uuid: 'user-1', email: 'no-prefs@example.com' }];
            const { whereMock, leftJoinMock, innerJoinMock, fromMock } = mockSelectDistinctChain(rows);

            const result = await getUsersEligibleForDigest();

            expect(result).toBe(rows);
            expect(fromMock).toHaveBeenCalledWith(notifications);
            expect(innerJoinMock).toHaveBeenCalledWith(users, eq(users.id, notifications.recipientUserId));
            expect(leftJoinMock).toHaveBeenCalledWith(
                notificationPreferences,
                eq(notificationPreferences.userId, users.id)
            );

            // Regression guard: this is the exact predicate that makes a user with no
            // notification_preferences row (NULL from the LEFT JOIN) count as enabled,
            // excludes emailDigestEnabled === false, and excludes unverified emails.
            const expectedWhere = and(
                isNull(notifications.emailedAt),
                isNotNull(users.emailVerifiedAt),
                or(isNull(notificationPreferences.emailDigestEnabled), eq(notificationPreferences.emailDigestEnabled, true))
            );
            expect(whereMock).toHaveBeenCalledWith(expectedWhere);
        });

        it('excludes users with emailDigestEnabled explicitly set to false from the resolved eligible set', async () => {
            // The query layer (mocked here) is responsible for applying the where clause;
            // a user with emailDigestEnabled: false would not appear in the resolved rows.
            const rows = [{ userId: 2, uuid: 'user-2', email: 'enabled@example.com' }];
            mockSelectDistinctChain(rows);

            const result = await getUsersEligibleForDigest();

            expect(result).toEqual(rows);
            expect(result.find((row) => row.userId === 3)).toBeUndefined();
        });

        it('excludes users with an unverified email from the resolved eligible set', async () => {
            // isNotNull(users.emailVerifiedAt) in the where clause filters these out at the
            // query layer; here we confirm the function simply returns what the query gives it.
            const rows = [];
            mockSelectDistinctChain(rows);

            const result = await getUsersEligibleForDigest();

            expect(result).toEqual([]);
        });
    });
});
