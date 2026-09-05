import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { authors, users } from '../../db/schema.ts';
import { defaultDisplayNameFromEmail, getSession } from '../../lib/auth.js';

export default async function Page() {
    const session = await getSession();
    const user = session?.user;

    if (!user) {
        return (
            <div className="max-w-xl py-12">
                <h1 className="mb-4">User</h1>
                <p className="mb-6">You’re not signed in.</p>
                <Link href="/login?redirectTo=%2Fuser" className="btn">
                    Log In
                </Link>
            </div>
        );
    }

    const [row] = await db
        .select({
            email: users.email,
            authorUuid: authors.uuid,
            authorName: authors.name
        })
        .from(users)
        .leftJoin(authors, eq(authors.userId, users.id))
        .where(eq(users.id, user.id))
        .limit(1);

    return (
        <div className="max-w-xl py-12">
            <h1 className="mb-4">User</h1>
            <div className="action-card">
                <p>Email: {row?.email}</p>
                <p>Name: {row?.authorName ?? defaultDisplayNameFromEmail(row?.email)}</p>
                <p>Author UUID: {row?.authorUuid ?? 'Not created yet'}</p>
            </div>
        </div>
    );
}
