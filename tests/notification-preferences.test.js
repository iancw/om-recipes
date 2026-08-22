import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let getEffectivePreferences;
let upsertNotificationPreferences;
let NOTIFICATION_PREFERENCE_DEFAULTS;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args)
    }
}));

describe('notification preferences', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/notifications.js');
        getEffectivePreferences = mod.getEffectivePreferences;
        upsertNotificationPreferences = mod.upsertNotificationPreferences;
        NOTIFICATION_PREFERENCE_DEFAULTS = mod.NOTIFICATION_PREFERENCE_DEFAULTS;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns defaults when no preferences row exists', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([]))
        }));

        const prefs = await getEffectivePreferences(42);
        expect(prefs).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
    });

    it('returns the stored row when one exists', async () => {
        const stored = {
            notifyNewRecipe: true,
            notifySampleImage: false,
            notifySave: true,
            emailDigestEnabled: false
        };
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([stored]))
        }));

        const prefs = await getEffectivePreferences(42);
        expect(prefs).toEqual(stored);
    });

    it('upserts preferences with onConflictDoUpdate on userId', async () => {
        const onConflictDoUpdate = vi.fn(() => Promise.resolve());
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        insertMock = vi.fn(() => ({ values }));

        await upsertNotificationPreferences(42, {
            notifyNewRecipe: true,
            notifySampleImage: false,
            notifySave: false,
            emailDigestEnabled: true
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 42,
                notifyNewRecipe: true,
                notifySampleImage: false,
                notifySave: false,
                emailDigestEnabled: true
            })
        );
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });
});
