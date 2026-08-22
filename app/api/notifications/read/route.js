import { requireUser } from '../../../../lib/auth.js';
import { markNotificationsRead } from '../../../../lib/notifications.js';

export async function POST(request) {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
        ? body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : undefined;

    await markNotificationsRead(session.user.id, { ids });

    return Response.json({ ok: true });
}
