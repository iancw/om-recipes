import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
import { buttonVariants } from 'components/ui/button';

export const metadata = {
    title: 'Privacy',
    description: 'Privacy notice and analytics settings for OM Recipes.'
};

const DATA_CATEGORIES = [
    'Account data: email address, verification timestamps, and session state used to sign you in.',
    'Profile data: display name plus optional social links you publish on your author profile.',
    'User content: recipes, uploaded sample images, image metadata, and camera EXIF data you submit.',
    'Security data: magic-link request details, session metadata, IP address, and user agent used to protect the app.',
    'Optional analytics: Google Analytics page-view data only after you grant analytics consent.'
];

const PROCESSORS = [
    'Netlify for application hosting and platform runtime.',
    'Neon/Postgres through Netlify DB for application data storage.',
    'Oracle Cloud Infrastructure for email delivery, object storage, and image-processing functions.',
    'Google Analytics 4 for optional traffic analytics when consent is granted.'
];

const RIGHTS = [
    'Review and update your public author-profile fields from your profile page.',
    'Request a downloadable export of your account data and available uploaded originals.',
    'Request account deletion, which removes your first-party account data and user-owned content from the app.',
    'Change your analytics-consent preference at any time from the footer control.'
];

export default function PrivacyPage() {
    return (
        <div className="space-y-6">
            <Card className="max-w-4xl">
                <CardHeader>
                    <CardTitle>Privacy</CardTitle>
                    <CardDescription>
                        OM Recipes is a community recipe library. This page summarizes what the app stores, which
                        services it relies on, and the controls available to you.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-sm leading-7 text-muted-foreground">
                    <section className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Data we process</h2>
                        <ul className="space-y-2">
                            {DATA_CATEGORIES.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Why we use it</h2>
                        <p>
                            OM Recipes uses account and security data to deliver passwordless login, maintain sessions,
                            protect the public sign-in flow, and let authors manage profiles and uploads. User content
                            is stored so recipes and image samples can be displayed publicly. Optional analytics helps
                            measure traffic only when you allow it.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Third-party processors</h2>
                        <ul className="space-y-2">
                            {PROCESSORS.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Your controls</h2>
                        <ul className="space-y-2">
                            {RIGHTS.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                        <div className="pt-2">
                            <Link href="/profile" className={buttonVariants()}>
                                Open profile privacy controls
                            </Link>
                        </div>
                    </section>
                </CardContent>
            </Card>
        </div>
    );
}
