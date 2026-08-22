import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.jsx';
import { buttonVariants } from '../../../components/ui/button.jsx';
import { unsubscribeFromEmailDigest } from '../../../lib/notifications.js';

export const metadata = {
    title: 'Unsubscribe'
};

export default async function Page({ searchParams }) {
    const resolvedSearchParams = await searchParams;
    const userUuid = String(resolvedSearchParams?.uid ?? '').trim();
    const token = String(resolvedSearchParams?.token ?? '').trim();

    let error = null;
    if (!userUuid || !token) {
        error = 'This unsubscribe link is missing required information.';
    } else {
        try {
            await unsubscribeFromEmailDigest({ userUuid, token });
        } catch (e) {
            error = e?.message || 'This unsubscribe link is invalid or has expired.';
        }
    }

    return (
        <Card className="max-w-xl">
            <CardHeader>
                <CardTitle>{error ? 'Unsubscribe failed' : "You're unsubscribed"}</CardTitle>
                <CardDescription>
                    {error ?? 'You will no longer receive the daily email digest from OM Recipes. You can still see notifications in the bell icon, and can re-enable email any time from your profile.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Link href="/profile" className={buttonVariants({ variant: 'outline' })}>
                    Manage notification preferences
                </Link>
            </CardContent>
        </Card>
    );
}
