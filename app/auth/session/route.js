import { getSession } from '../../../lib/auth.js';

export async function GET() {
    const session = await getSession();

    return Response.json(
        {
            user: session?.user
                ? {
                    id: session.user.id,
                    uuid: session.user.uuid,
                    email: session.user.email,
                    name: session.user.name
                }
                : null
        },
        {
            headers: {
                'cache-control': 'private, no-store, max-age=0'
            }
        }
    );
}
