import Link from 'next/link';
import { Button, buttonVariants } from 'components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
import { getSession } from '../../lib/auth.js';
import { getEffectivePreferences } from '../../lib/notifications.js';
import { listPrivacyRequestsForUser, PRIVACY_REQUEST_STATUS_COMPLETED, PRIVACY_REQUEST_TYPE_EXPORT } from '../../lib/privacy.js';
import { deleteMyAccountAction, requestMyDataExportAction, updateMyNotificationPreferencesAction, updateMyProfileAction } from './actions';
import { NotificationPreferencesForm } from './notifications-form';
import { ProfileForm } from './profile-form';

export const metadata = {
    title: 'Profile'
};

export default async function Page() {
    const session = await getSession();
    const user = session?.user;
    const author = session?.author;

    if (!user) {
        return (
            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>Please log in to edit your profile.</CardDescription>
                </CardHeader>
                <CardContent>
                <Link href="/login?redirectTo=%2Fprofile" className={buttonVariants()}>
                    Log in
                </Link>
                </CardContent>
            </Card>
        );
    }

    const privacyRequests = await listPrivacyRequestsForUser(user.id);
    const notificationPreferences = await getEffectivePreferences(user.id);

    return (
        <div className="w-full space-y-6">
            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>
                        These fields control what’s shown publicly for you as an author profile.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                <ProfileForm
                    action={updateMyProfileAction}
                    initialValues={{
                        name: author?.name ?? user.name ?? '',
                        instagramLink: author?.instagramLink ?? '',
                        flickrLink: author?.flickrLink ?? '',
                        website: author?.website ?? '',
                        kofiLink: author?.kofiLink ?? ''
                    }}
                />
                </CardContent>
            </Card>

            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Notifications</CardTitle>
                    <CardDescription>
                        Choose what you hear about in the bell icon and in your daily email digest.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <NotificationPreferencesForm
                        action={updateMyNotificationPreferencesAction}
                        initialValues={notificationPreferences}
                    />
                </CardContent>
            </Card>

            <Card className="max-w-3xl">
                <CardHeader>
                    <CardTitle>Privacy controls</CardTitle>
                    <CardDescription>
                        Review the privacy notice, request an export of your account data, or permanently delete your
                        account and user-owned content.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex flex-wrap gap-3">
                        <Link href="/privacy" className={buttonVariants({ variant: 'outline' })}>
                            Read privacy notice
                        </Link>
                        <form action={requestMyDataExportAction}>
                            <Button type="submit">Request data export</Button>
                        </form>
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Recent privacy requests</h2>
                        {privacyRequests.length === 0 ? (
                            <p className="text-sm leading-6 text-muted-foreground">
                                No export or deletion requests have been recorded for this account yet.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {privacyRequests.map((request) => {
                                    const canDownload =
                                        request.requestType === PRIVACY_REQUEST_TYPE_EXPORT
                                        && request.status === PRIVACY_REQUEST_STATUS_COMPLETED
                                        && request.artifactFileName
                                        && (!request.artifactExpiresAt || request.artifactExpiresAt > new Date());

                                    return (
                                        <div
                                            key={request.id}
                                            className="rounded-2xl border border-border/70 px-4 py-4 text-sm text-muted-foreground"
                                        >
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="space-y-1">
                                                    <p className="font-medium text-foreground">
                                                        {request.requestType === PRIVACY_REQUEST_TYPE_EXPORT
                                                            ? 'Data export'
                                                            : 'Account deletion'}
                                                    </p>
                                                    <p>Status: {request.status}</p>
                                                    <p>Requested: {new Date(request.createdAt).toLocaleString()}</p>
                                                    {request.completedAt ? (
                                                        <p>Completed: {new Date(request.completedAt).toLocaleString()}</p>
                                                    ) : null}
                                                    {request.failureSummary ? <p>Failure: {request.failureSummary}</p> : null}
                                                    {request.artifactExpiresAt ? (
                                                        <p>Download expires: {new Date(request.artifactExpiresAt).toLocaleString()}</p>
                                                    ) : null}
                                                </div>
                                                {canDownload ? (
                                                    <Link
                                                        href={`/profile/privacy-requests/${request.uuid}/download`}
                                                        className={buttonVariants({ variant: 'outline' })}
                                                    >
                                                        Download export
                                                    </Link>
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="space-y-3 rounded-3xl border border-destructive/30 bg-destructive/5 px-5 py-5">
                        <div className="space-y-1">
                            <h2 className="text-base font-semibold text-foreground">Delete account</h2>
                            <p className="text-sm leading-6 text-muted-foreground">
                                This permanently removes your login, public profile, saved recipes, mode-slot settings,
                                authored recipes, uploaded sample images, and associated storage objects.
                            </p>
                        </div>
                        <form action={deleteMyAccountAction} className="flex flex-col gap-3">
                            <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-foreground">Type DELETE to confirm</span>
                                <input
                                    name="confirmation"
                                    className="rounded-full border border-input bg-background px-4 py-2 text-sm text-foreground"
                                    autoComplete="off"
                                    required
                                />
                            </label>
                            <div>
                                <Button type="submit" variant="destructive">
                                    Delete account
                                </Button>
                            </div>
                        </form>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
