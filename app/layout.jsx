import '../styles/globals.css';
import { Footer } from '../components/footer';
import { Header } from '../components/header';
import { GA4PageView } from '../components/ga4';
import { AnalyticsConsentBanner } from '../components/AnalyticsConsentBanner';
import Script from 'next/script';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { ANALYTICS_CONSENT_COOKIE, analyticsConsentGranted, normalizeAnalyticsConsent } from '../lib/privacy-consent.js';

export const metadata = {
    title: {
        template: '%s | OM Recipes',
        default: 'OM Recipes'
    },
    description: 'Discover and share color and monochrome recipes for OM System and Olympus cameras.'
};

export default async function RootLayout({ children }) {
    const measurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    const cookieStore = await cookies();
    const analyticsConsent = normalizeAnalyticsConsent(cookieStore.get(ANALYTICS_CONSENT_COOKIE)?.value);
    const shouldLoadAnalytics = Boolean(measurementId) && analyticsConsentGranted(analyticsConsent);

    return (
        // Some browser extensions (notably Google Tag Assistant) inject
        // `data-tag-assistant-*` attributes onto the <html> element before React
        // hydrates, which triggers a dev hydration warning.
        <html lang="en" suppressHydrationWarning>
            <head>
                <link rel="icon" href="/favicon.svg" sizes="any" />

                {shouldLoadAnalytics ? (
                    <>
                        <Script
                            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
                            strategy="afterInteractive"
                        />
                        <Script id="ga4-init" strategy="afterInteractive">
                            {`
                              window.dataLayer = window.dataLayer || [];
                              function gtag(){dataLayer.push(arguments);}
                              window.gtag = window.gtag || gtag;
                              gtag('js', new Date());

                              // Disable automatic page_view so we can handle SPA navigation.
                              gtag('config', '${measurementId}', { send_page_view: false });
                            `}
                        </Script>
                    </>
                ) : null}
            </head>
            <body className="antialiased" suppressHydrationWarning>
                {/* useSearchParams() requires a Suspense boundary in App Router */}
                <Suspense fallback={null}>
                    <GA4PageView measurementId={measurementId} consent={analyticsConsent} />
                </Suspense>
                <AnalyticsConsentBanner initialConsent={analyticsConsent} />
                <div className="flex min-h-screen flex-col px-4 sm:px-6">
                    <div className="flex flex-col w-full grow">
                        <Header />
                        <main className="grow">
                            <div className="mx-auto w-full max-w-7xl">{children}</div>
                        </main>
                        <Footer />
                    </div>
                </div>
            </body>
        </html>
    );
}
