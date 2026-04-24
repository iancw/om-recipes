import { describe, expect, it } from 'vitest';
import {
    ANALYTICS_CONSENT_COOKIE,
    ANALYTICS_CONSENT_DENIED,
    ANALYTICS_CONSENT_GRANTED,
    analyticsConsentGranted,
    buildAnalyticsConsentCookie,
    getAnalyticsConsentFromCookieString,
    normalizeAnalyticsConsent
} from '../lib/privacy-consent.js';

describe('privacy consent helpers', () => {
    it('defaults to denied behavior when consent is absent', () => {
        expect(normalizeAnalyticsConsent(undefined)).toBeNull();
        expect(analyticsConsentGranted(undefined)).toBe(false);
    });

    it('treats only the granted value as analytics-enabled', () => {
        expect(analyticsConsentGranted(ANALYTICS_CONSENT_GRANTED)).toBe(true);
        expect(analyticsConsentGranted(ANALYTICS_CONSENT_DENIED)).toBe(false);
    });

    it('reads the consent value from a cookie string', () => {
        const cookieValue = `theme=light; ${ANALYTICS_CONSENT_COOKIE}=${ANALYTICS_CONSENT_GRANTED}; other=value`;
        expect(getAnalyticsConsentFromCookieString(cookieValue)).toBe(ANALYTICS_CONSENT_GRANTED);
    });

    it('builds a first-party cookie string for the selected consent value', () => {
        const cookie = buildAnalyticsConsentCookie(ANALYTICS_CONSENT_DENIED, { secure: false });
        expect(cookie).toContain(`${ANALYTICS_CONSENT_COOKIE}=${ANALYTICS_CONSENT_DENIED}`);
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).not.toContain('Secure');
    });
});
