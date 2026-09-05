import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let updateMock;
let revalidatePathMock;
let revalidateCatalogMock;
let revalidateRecipeDetailMock;
let findOrCreateAuthorForUserMock;
let addAuthorIdToUserStateMock;
let updateMyProfileAction;

vi.mock('../lib/auth.js', () => ({
    requireUser: () => Promise.resolve({ user: { id: 9, uuid: 'owner-uuid', email: 'owner@example.com' } }),
    findOrCreateAuthorForUser: (...args) => findOrCreateAuthorForUserMock(...args),
    clearSessionCookie: vi.fn()
}));

vi.mock('../lib/user-state-cache.js', () => ({
    addAuthorIdToUserState: (...args) => addAuthorIdToUserStateMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({ upsertNotificationPreferences: vi.fn() }));

vi.mock('../lib/privacy.js', () => ({
    startAccountDeletion: vi.fn(),
    startPrivacyExport: vi.fn()
}));

vi.mock('../lib/public-recipe-catalog-cache.js', () => ({
    revalidatePublicRecipeCatalog: (...a) => revalidateCatalogMock(...a),
    revalidateRecipeDetail: (...a) => revalidateRecipeDetailMock(...a)
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        update: (...args) => updateMock(...args)
    }
}));

vi.mock('next/cache', () => ({
    revalidatePath: (...args) => revalidatePathMock(...args)
}));

function makeFormData(entries) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) {
        if (value != null) fd.set(key, value);
    }
    return fd;
}

describe('updateMyProfileAction', () => {
    beforeEach(async () => {
        vi.resetModules();
        revalidatePathMock = vi.fn();
        revalidateCatalogMock = vi.fn(() => Promise.resolve());
        revalidateRecipeDetailMock = vi.fn(() => Promise.resolve());
        findOrCreateAuthorForUserMock = vi.fn(() => Promise.resolve({ id: 77 }));
        addAuthorIdToUserStateMock = vi.fn(() => Promise.resolve());

        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ id: 501 }, { id: 502 }]))
        }));
        updateMock = vi.fn(() => ({
            set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }))
        }));

        const mod = await import('../app/profile/actions.js');
        updateMyProfileAction = mod.updateMyProfileAction;
    });

    afterEach(() => vi.restoreAllMocks());

    it('busts the catalog cache and every one of the author\'s recipe-detail caches', async () => {
        await updateMyProfileAction(makeFormData({ name: 'New Name' }));

        expect(addAuthorIdToUserStateMock).toHaveBeenCalledWith('owner-uuid', 77);
        expect(revalidateCatalogMock).toHaveBeenCalledTimes(1);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(501);
        expect(revalidateRecipeDetailMock).toHaveBeenCalledWith(502);
        expect(revalidatePathMock).toHaveBeenCalledWith('/profile');
    });
});
