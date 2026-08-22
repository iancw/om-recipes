// tests/recipe-saves.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let insertMock;
let deleteMock;
let notifyRecipeSavedMock;
let toggleSavedRecipeForUser;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args),
        insert: (...args) => insertMock(...args),
        delete: (...args) => deleteMock(...args)
    }
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: (...args) => notifyRecipeSavedMock(...args)
}));

describe('toggleSavedRecipeForUser', () => {
    beforeEach(async () => {
        vi.resetModules();
        notifyRecipeSavedMock = vi.fn(() => Promise.resolve());
        const mod = await import('../lib/recipe-saves.js');
        toggleSavedRecipeForUser = mod.toggleSavedRecipeForUser;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('notifies the owner when saving (insert branch)', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([]))
        }));
        insertMock = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));

        const result = await toggleSavedRecipeForUser({ userId: 20, recipeId: 5 });

        expect(result).toEqual({ isSaved: true });
        expect(notifyRecipeSavedMock).toHaveBeenCalledWith(5, 20);
    });

    it('does not notify when unsaving (delete branch)', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn(() => Promise.resolve([{ recipeId: 5 }]))
        }));
        deleteMock = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));

        const result = await toggleSavedRecipeForUser({ userId: 20, recipeId: 5 });

        expect(result).toEqual({ isSaved: false });
        expect(notifyRecipeSavedMock).not.toHaveBeenCalled();
    });
});
