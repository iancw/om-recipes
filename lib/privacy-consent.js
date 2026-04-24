export const ANALYTICS_CONSENT_COOKIE = 'om_analytics_consent';
export const ANALYTICS_CONSENT_GRANTED = 'granted';
export const ANALYTICS_CONSENT_DENIED = 'denied';
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function normalizeAnalyticsConsent(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === ANALYTICS_CONSENT_GRANTED || normalized === ANALYTICS_CONSENT_DENIED) {
        return normalized;
    }
    return null;
}

export function analyticsConsentGranted(value) {
    return normalizeAnalyticsConsent(value) === ANALYTICS_CONSENT_GRANTED;
}

export function getAnalyticsConsentFromCookieString(cookieString) {
    const entries = String(cookieString ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean);

    for (const entry of entries) {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex === -1) continue;

        const name = entry.slice(0, separatorIndex).trim();
        if (name !== ANALYTICS_CONSENT_COOKIE) continue;

        return normalizeAnalyticsConsent(decodeURIComponent(entry.slice(separatorIndex + 1)));
    }

    return null;
}

export function buildAnalyticsConsentCookie(value, { secure = true } = {}) {
    const normalized = normalizeAnalyticsConsent(value);
    if (!normalized) {
        throw new Error('Invalid analytics consent value');
    }

    const parts = [
        `${ANALYTICS_CONSENT_COOKIE}=${encodeURIComponent(normalized)}`,
        'Path=/',
        `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`,
        'SameSite=Lax'
    ];

    if (secure) {
        parts.push('Secure');
    }

    return parts.join('; ');
}
