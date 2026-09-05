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

describe('getAllSavedRecipeIdsForUser', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        globalThis.__getAllSavedRecipeIdsForUser = mod.getAllSavedRecipeIdsForUser;
    });

    it('returns every recipe id the user has saved, unfiltered', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 5 }, { recipeId: 9 }]))
        }));

        const result = await globalThis.__getAllSavedRecipeIdsForUser(20);

        expect(result).toEqual(new Set([5, 9]));
    });

    it('returns an empty set for an invalid user id', async () => {
        const result = await globalThis.__getAllSavedRecipeIdsForUser(NaN);
        expect(result).toEqual(new Set());
    });
});

describe('reconcileSavedRecipesForUser', () => {
    let insertValuesMock;
    let deleteWhereMock;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        globalThis.__reconcileSavedRecipesForUser = mod.reconcileSavedRecipesForUser;
    });

    it('inserts missing rows and deletes extra rows to match the desired set', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 1 }, { recipeId: 2 }]))
        }));
        insertValuesMock = vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) }));
        insertMock = vi.fn(() => ({ values: insertValuesMock }));
        deleteWhereMock = vi.fn(() => Promise.resolve());
        deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

        await globalThis.__reconcileSavedRecipesForUser({ userId: 20, desiredRecipeIds: [2, 3] });

        expect(insertValuesMock).toHaveBeenCalledWith([{ userId: 20, recipeId: 3 }]);
        expect(deleteWhereMock).toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledWith(expect.anything());
    });

    it('does nothing when the desired set already matches Postgres', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ recipeId: 1 }]))
        }));
        insertMock = vi.fn();
        deleteMock = vi.fn();

        await globalThis.__reconcileSavedRecipesForUser({ userId: 20, desiredRecipeIds: [1] });

        expect(insertMock).not.toHaveBeenCalled();
        expect(deleteMock).not.toHaveBeenCalled();
    });
});
