import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_REVALIDATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function requireSigningSecret() {
    const secret = process.env.AUTH_SESSION_SIGNING_SECRET;
    if (!secret) {
        throw new Error('AUTH_SESSION_SIGNING_SECRET is not set');
    }
    return secret;
}

function sign(payloadB64) {
    return createHmac('sha256', requireSigningSecret()).update(payloadB64).digest('base64url');
}

export function signSessionPayload(payload) {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionCookie(cookieValue) {
    if (typeof cookieValue !== 'string' || cookieValue.length === 0) return null;

    const separatorIndex = cookieValue.lastIndexOf('.');
    if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1) return null;

    const payloadB64 = cookieValue.slice(0, separatorIndex);
    const signatureB64 = cookieValue.slice(separatorIndex + 1);

    let expectedSignature;
    try {
        expectedSignature = sign(payloadB64);
    } catch {
        return null;
    }

    const expected = Buffer.from(expectedSignature, 'base64url');
    const actual = Buffer.from(signatureB64, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}
