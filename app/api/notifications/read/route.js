import { requireUser } from '../../../../lib/auth.js';
import { markNotificationsReadInUserState } from '../../../../lib/user-state-cache.js';

export async function POST(request) {
    let session;
    try {
        session = await requireUser();
    } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const uuids = Array.isArray(body?.uuids)
        ? body.uuids.filter((value) => typeof value === 'string' && value.length > 0)
        : undefined;

    await markNotificationsReadInUserState(session.user.uuid, session.user.id, { uuids });

    return Response.json({ ok: true });
}
