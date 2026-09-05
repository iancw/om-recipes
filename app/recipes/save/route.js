import { getSession } from '../../../lib/auth.js';
import { getRecipeIndex } from '../../../lib/public-recipe-catalog.js';
import { toggleSavedRecipeInState } from '../../../lib/user-state-cache.js';
import { notifyRecipeSaved } from '../../../lib/notifications.js';

export async function POST(request) {
    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const uuid = session?.user?.uuid ?? null;

    if (userId == null || uuid == null) {
        const body = await request.json().catch(() => ({}));
        const redirectTo = typeof body?.redirectTo === 'string' && body.redirectTo.trim() ? body.redirectTo.trim() : '/';
        return Response.json(
            {
                error: 'Authentication required',
                loginUrl: `/login?redirectTo=${encodeURIComponent(redirectTo)}`
            },
            { status: 401 }
        );
    }

    const body = await request.json().catch(() => ({}));
    const recipeId = Number(body?.recipeId);
    if (!Number.isFinite(recipeId)) {
        return Response.json({ error: 'Invalid recipe id' }, { status: 400 });
    }

    const index = await getRecipeIndex();
    if (!index.some((entry) => entry.id === recipeId)) {
        return Response.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const isSaved = await toggleSavedRecipeInState(uuid, userId, recipeId);
    if (isSaved) {
        await notifyRecipeSaved(recipeId, userId);
    }

    return Response.json({ isSaved });
}
