import Link from 'next/link';
import { cookies } from 'next/headers';
import { Badge } from 'components/ui/badge';
import { AnalyticsConsentSettings } from './AnalyticsConsentBanner';
import { ANALYTICS_CONSENT_COOKIE, normalizeAnalyticsConsent } from '../lib/privacy-consent.js';

export async function Footer() {
    const cookieStore = await cookies();
    const analyticsConsent = normalizeAnalyticsConsent(cookieStore.get(ANALYTICS_CONSENT_COOKIE)?.value);

    return (
        <footer className="pt-12 pb-10 sm:pt-16 sm:pb-14">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 rounded-3xl border border-border/70 bg-card/70 px-6 py-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-2">
                    <Badge variant="outline">OM Recipes</Badge>
                    <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                        A searchable OM System color recipe library with author samples, export files, and profile-backed uploads.
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground sm:items-end">
                    <p>Built for recipe discovery, comparison, and download.</p>
                    <div className="flex flex-wrap gap-3">
                        <Link href="/privacy" className="underline underline-offset-4 transition hover:text-foreground">
                            Privacy
                        </Link>
                        <Link href="/terms" className="underline underline-offset-4 transition hover:text-foreground">
                            Terms
                        </Link>
                        <AnalyticsConsentSettings initialConsent={analyticsConsent} />
                    </div>
                </div>
            </div>
        </footer>
    );
}
