'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ANALYTICS_CONSENT_DENIED,
    ANALYTICS_CONSENT_GRANTED,
    analyticsConsentGranted,
    buildAnalyticsConsentCookie,
    normalizeAnalyticsConsent
} from '../lib/privacy-consent.js';

function writeConsentCookie(value) {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    document.cookie = buildAnalyticsConsentCookie(value, { secure: isHttps });
}

function consentLabel(consent) {
    if (consent === ANALYTICS_CONSENT_GRANTED) return 'Analytics on';
    if (consent === ANALYTICS_CONSENT_DENIED) return 'Analytics off';
    return 'Analytics not set';
}

export function AnalyticsConsentBanner({ initialConsent = null }) {
    const router = useRouter();
    const [consent, setConsent] = useState(normalizeAnalyticsConsent(initialConsent));

    if (consent) return null;

    const updateConsent = (nextValue) => {
        writeConsentCookie(nextValue);
        setConsent(nextValue);
        router.refresh();
    };

    return (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-3xl border border-border bg-card px-5 py-4 shadow-lg">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Privacy choices</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                        OM Recipes uses optional analytics to understand site traffic. Core login, recipe browsing, and
                        uploads work without analytics.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                        onClick={() => updateConsent(ANALYTICS_CONSENT_DENIED)}
                    >
                        Continue without analytics
                    </button>
                    <button
                        type="button"
                        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                        onClick={() => updateConsent(ANALYTICS_CONSENT_GRANTED)}
                    >
                        Allow analytics
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AnalyticsConsentSettings({ initialConsent = null }) {
    const router = useRouter();
    const [consent, setConsent] = useState(normalizeAnalyticsConsent(initialConsent));

    const nextValue = analyticsConsentGranted(consent)
        ? ANALYTICS_CONSENT_DENIED
        : ANALYTICS_CONSENT_GRANTED;

    const handleToggle = () => {
        writeConsentCookie(nextValue);
        setConsent(nextValue);
        router.refresh();
    };

    return (
        <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
            onClick={handleToggle}
        >
            {consentLabel(consent)}. {analyticsConsentGranted(consent) ? 'Turn off analytics' : 'Allow analytics'}
        </button>
    );
}
