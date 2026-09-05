import { requireUser } from '../../../lib/auth.js';
import { getUserSavedState, unreadNotificationCount } from '../../../lib/user-state-cache.js';

export async function GET() {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const state = await getUserSavedState(session.user.uuid, session.user.id);
    const items = state.notifications ?? [];

    return Response.json(
        { items, unreadCount: unreadNotificationCount(items) },
        { headers: { 'cache-control': 'private, no-store, max-age=0' } }
    );
}
