import Link from 'next/link';
import { Alert } from 'components/alert';
import { Button, buttonVariants } from 'components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
import { Input } from 'components/ui/input';
import { getSession, normalizeRedirectPath } from '../../lib/auth.js';

export const metadata = {
    title: 'Log In',
    description: 'Sign in to OM Recipes to upload and manage your color and monochrome recipes for OM System and Olympus cameras.'
};

function getErrorMessage(code) {
    switch (String(code ?? '')) {
        case 'invalid_email':
            return 'Please enter a valid email address.';
        case 'missing_token':
            return 'That sign-in link is missing required information.';
        case 'invalid_link':
            return 'That sign-in link is invalid or has already been used.';
        case 'expired_link':
            return 'That sign-in link has expired. Request a new one.';
        case 'unable_to_send':
            return 'Unable to send a sign-in link right now. Please try again.';
        case 'unable_to_sign_in':
            return 'Unable to complete sign-in right now. Please try again.';
        default:
            return '';
    }
}

export default async function LoginPage({ searchParams }) {
    const session = await getSession();
    const resolvedSearchParams = await searchParams;
    const redirectTo = normalizeRedirectPath(resolvedSearchParams?.redirectTo, '/profile');
    const sent = resolvedSearchParams?.sent === '1';
    const deleted = resolvedSearchParams?.deleted === '1';
    const error = getErrorMessage(resolvedSearchParams?.error);

    if (session?.user) {
        return (
            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Log In</CardTitle>
                    <CardDescription>You’re already signed in as {session.user.email}.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Link href={redirectTo} className={buttonVariants()}>
                        Continue
                    </Link>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="max-w-xl">
            <CardHeader>
                <CardTitle>Log In</CardTitle>
                <CardDescription>
                    Enter your email address and OM Recipes will send you a one-time magic link. Sessions roll for 14
                    days while you stay active.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {deleted ? <Alert type="success">Your account has been deleted and you’ve been signed out.</Alert> : null}
                {sent ? <Alert type="success">Check your email for a sign-in link.</Alert> : null}
                {error ? <Alert type="error">{error}</Alert> : null}

                <form action="/auth/request-link" method="post" className="flex flex-col gap-4">
                    <input type="hidden" name="redirectTo" value={redirectTo} />

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-foreground">Email address</span>
                        <Input
                            type="email"
                            name="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            required
                        />
                    </label>

                    <div className="pt-2">
                        <Button type="submit">Send Magic Link</Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
