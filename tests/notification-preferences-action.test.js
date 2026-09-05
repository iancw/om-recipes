import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let upsertNotificationPreferencesMock;
let revalidatePathMock;
let reconcileUserStateMock;
let updateMyNotificationPreferencesAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, email: 'owner@example.com', uuid: 'owner-uuid' } }),
    findOrCreateAuthorForUser: vi.fn(),
    clearSessionCookie: vi.fn()
}));

vi.mock('../lib/user-state-flush.js', () => ({
    reconcileUserState: (...args) => reconcileUserStateMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    upsertNotificationPreferences: (...args) => upsertNotificationPreferencesMock(...args)
}));

vi.mock('../lib/privacy.js', () => ({
    startAccountDeletion: vi.fn(),
    startPrivacyExport: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: vi.fn(() => Promise.resolve())
}));

vi.mock('../db/index.ts', () => ({
    db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })) }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

describe('updateMyNotificationPreferencesAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        upsertNotificationPreferencesMock = vi.fn(() => Promise.resolve());
        revalidatePathMock = vi.fn();
        reconcileUserStateMock = vi.fn(() => Promise.resolve());
        const mod = await import('../app/profile/actions.js');
        updateMyNotificationPreferencesAction = mod.updateMyNotificationPreferencesAction;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('maps checked boxes to true and unchecked to false', async () => {
        const formData = new FormData();
        formData.set('notifySampleImage', 'on');
        formData.set('notifyComment', 'on');
        formData.set('emailDigestEnabled', 'on');
        // notifyNewRecipe and notifySave intentionally omitted (unchecked boxes are absent from FormData)

        await updateMyNotificationPreferencesAction(formData);

        expect(upsertNotificationPreferencesMock).toHaveBeenCalledWith(9, {
            notifyNewRecipe: false,
            notifySampleImage: true,
            notifySave: false,
            notifyComment: true,
            emailDigestEnabled: true
        });
        expect(revalidatePathMock).toHaveBeenCalledWith('/profile');
        expect(reconcileUserStateMock).toHaveBeenCalledWith('owner-uuid');
    });
});
