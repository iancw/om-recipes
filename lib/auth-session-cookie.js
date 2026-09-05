export const AUTH_SESSION_COOKIE = 'om_session';
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

function nowPlus(ms) {
    return new Date(Date.now() + ms);
}

function authCookieDomainFromEnv() {
    const raw = String(process.env.AUTH_COOKIE_DOMAIN ?? '').trim();
    if (!raw) return undefined;
    return raw.replace(/^\./, '');
}

export function sessionCookieBaseOptions() {
    const domain = authCookieDomainFromEnv();

    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        ...(domain ? { domain } : {})
    };
}

export function sessionCookieOptions(expiresAt = nowPlus(SESSION_MAX_AGE_MS)) {
    return {
        ...sessionCookieBaseOptions(),
        expires: expiresAt,
        maxAge: SESSION_MAX_AGE_SECONDS
    };
}
