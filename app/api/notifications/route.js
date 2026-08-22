import { requireUser } from '../../../lib/auth.js';
import { getNotificationsForUser, getUnreadCount } from '../../../lib/notifications.js';

export async function GET() {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const [items, unreadCount] = await Promise.all([
        getNotificationsForUser(session.user.id, { limit: 50 }),
        getUnreadCount(session.user.id)
    ]);

    return Response.json(
        { items, unreadCount },
        { headers: { 'cache-control': 'private, no-store, max-age=0' } }
    );
}
