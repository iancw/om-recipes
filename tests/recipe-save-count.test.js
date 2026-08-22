// tests/recipe-save-count.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
let getSaveCountForRecipe;

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: vi.fn(() => Promise.resolve())
}));

describe('getSaveCountForRecipe', () => {
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../lib/recipe-saves.js');
        getSaveCountForRecipe = mod.getSaveCountForRecipe;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the count of saves for a recipe', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 4 }]))
        }));

        await expect(getSaveCountForRecipe(5)).resolves.toBe(4);
    });

    it('returns 0 when there are no saves', async () => {
        selectMock = vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn(() => Promise.resolve([{ value: 0 }]))
        }));

        await expect(getSaveCountForRecipe(5)).resolves.toBe(0);
    });
});
