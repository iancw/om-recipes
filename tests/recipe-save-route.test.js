import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server.js';

let getSessionMock;
let getRecipeIndexMock;
let toggleSavedRecipeInStateMock;
let notifyRecipeSavedMock;

vi.mock('../lib/auth.js', () => ({
    getSession: (...args) => getSessionMock(...args)
}));

vi.mock('../lib/public-recipe-catalog.js', () => ({
    getRecipeIndex: (...args) => getRecipeIndexMock(...args)
}));

vi.mock('../lib/user-state-cache.js', () => ({
    toggleSavedRecipeInState: (...args) => toggleSavedRecipeInStateMock(...args)
}));

vi.mock('../lib/notifications.js', () => ({
    notifyRecipeSaved: (...args) => notifyRecipeSavedMock(...args)
}));

describe('recipe save route', () => {
    beforeEach(() => {
        vi.resetModules();
        getSessionMock = vi.fn(() => Promise.resolve(null));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 123 }]));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(true));
        notifyRecipeSavedMock = vi.fn(() => Promise.resolve());
    });

    it('returns a login URL when the viewer is not authenticated', async () => {
        getSessionMock = vi.fn(() => Promise.resolve(null));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123, redirectTo: '/recipes/abc?id=123' }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
            error: 'Authentication required',
            loginUrl: '/login?redirectTo=%2Frecipes%2Fabc%3Fid%3D123'
        });
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });

    it('toggles the saved state via the cache for an authenticated user and notifies on save', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(true));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(toggleSavedRecipeInStateMock).toHaveBeenCalledWith('user-uuid', 42, 123);
        expect(notifyRecipeSavedMock).toHaveBeenCalledWith(123, 42);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ isSaved: true });
    });

    it('does not notify when the toggle results in unsaving', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        toggleSavedRecipeInStateMock = vi.fn(() => Promise.resolve(false));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(notifyRecipeSavedMock).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({ isSaved: false });
    });

    it('rejects a recipe id that is not in the cached index, with no DB call', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        getRecipeIndexMock = vi.fn(() => Promise.resolve([{ id: 999 }]));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 123 }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(404);
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric recipe id', async () => {
        getSessionMock = vi.fn(() => Promise.resolve({ user: { id: 42, uuid: 'user-uuid' } }));
        const { POST } = await import('../app/recipes/save/route.js');

        const request = new NextRequest('https://www.omrecipes.dev/recipes/save', {
            method: 'POST',
            body: JSON.stringify({ recipeId: 'nope' }),
            headers: { 'content-type': 'application/json' }
        });

        const response = await POST(request);

        expect(response.status).toBe(400);
        expect(toggleSavedRecipeInStateMock).not.toHaveBeenCalled();
    });
});
