import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authMagicLinks, authSessions, authors, users } from '../db/schema.ts';
import {
    AUTH_SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    sessionCookieBaseOptions,
    sessionCookieOptions
} from './auth-session-cookie.js';
import { signSessionPayload, verifySessionCookie, SESSION_REVALIDATION_INTERVAL_MS } from './auth-session-token.js';
import { publicAppBaseUrl } from './auth-url.js';
export { normalizeRedirectPath } from './redirect-path.js';
import { normalizeRedirectPath } from './redirect-path.js';

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const MAGIC_LINK_MAX_AGE_MS = 20 * 60 * 1000;

function nowPlus(ms) {
    return new Date(Date.now() + ms);
}

function hashToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
    return randomBytes(32).toString('base64url');
}

export function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function defaultDisplayNameFromEmail(email) {
    const localPart = normalizeEmail(email).split('@')[0] ?? '';
    const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
    return cleaned || 'OM Recipes author';
}

async function setSessionCookie(token, expiresAt) {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_SESSION_COOKIE, '', {
        ...sessionCookieBaseOptions(),
        expires: new Date(0),
        maxAge: 0
    });
}

async function safeSetSessionCookie(token, expiresAt) {
    try {
        await setSessionCookie(token, expiresAt);
    } catch {
        // Server component renders cannot always mutate cookies.
    }
}

async function safeClearSessionCookie() {
    try {
        await clearSessionCookie();
    } catch {
        // Server component renders cannot always mutate cookies.
    }
}

async function getSessionTokenFromCookies() {
    const cookieStore = await cookies();
    return cookieStore.get(AUTH_SESSION_COOKIE)?.value ?? null;
}

async function findOrCreateUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email);

    const existing = await db
        .select({
            id: users.id,
            uuid: users.uuid,
            email: users.email
        })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

    if (existing.length > 0) {
        return existing[0];
    }

    const created = await db
        .insert(users)
        .values({
            email: normalizedEmail
        })
        .returning({
            id: users.id,
            uuid: users.uuid,
            email: users.email
        });

    return created[0];
}

export async function findOrCreateAuthorForUser({ userId, email, displayName }) {
    const existing = await db
        .select({
            id: authors.id,
            uuid: authors.uuid,
            name: authors.name
        })
        .from(authors)
        .where(eq(authors.userId, userId))
        .orderBy(asc(authors.id))
        .limit(1);

    if (existing.length > 0) {
        return existing[0];
    }

    const userRows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (userRows.length === 0) {
        throw new Error('Your account no longer exists. Please sign in again.');
    }

    const created = await db
        .insert(authors)
        .values({
            userId,
            name: String(displayName ?? '').trim() || defaultDisplayNameFromEmail(email)
        })
        .returning({
            id: authors.id,
            uuid: authors.uuid,
            name: authors.name
        });

    return created[0];
}

async function createMagicLink({ email, redirectTo, requestedIp, requestedUserAgent }) {
    const user = await findOrCreateUserByEmail(email);
    const token = newToken();

    await db.insert(authMagicLinks).values({
        userId: user.id,
        tokenHash: hashToken(token),
        redirectTo: normalizeRedirectPath(redirectTo, '/profile'),
        requestedIp: requestedIp || null,
        requestedUserAgent: requestedUserAgent || null,
        expiresAt: nowPlus(MAGIC_LINK_MAX_AGE_MS)
    });

    return { token, user };
}

async function createSession({ userId, ipAddress, userAgent }) {
    // authSessions.tokenHash is NOT NULL with a unique index; this placeholder
    // token satisfies that constraint but is no longer the read-path lookup
    // key — sessions are found by id (sid) once verified via the signed cookie.
    const placeholderToken = newToken();
    const expiresAt = nowPlus(SESSION_MAX_AGE_MS);

    const [row] = await db
        .insert(authSessions)
        .values({
            userId,
            tokenHash: hashToken(placeholderToken),
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
            expiresAt,
            lastSeenAt: new Date()
        })
        .returning({ id: authSessions.id });

    return { sessionId: row.id, expiresAt };
}

async function deleteSessionById(sessionId) {
    if (!sessionId) return;
    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

function buildMagicLinkEmail({ magicLinkUrl, redirectTo }) {
    const safeRedirect = normalizeRedirectPath(redirectTo, '/profile');
    return {
        subject: 'Your OM Recipes sign-in link',
        text: `Use this link to sign in to OM Recipes: ${magicLinkUrl}\n\nThis link expires in 20 minutes.\n\nAfter sign-in you will land on ${safeRedirect}.`,
        html: `<p>Use this link to sign in to OM Recipes:</p><p><a href="${magicLinkUrl}">Sign in to OM Recipes</a></p><p>This link expires in 20 minutes.</p>`
    };
}

export async function sendMagicLinkEmail({
    email,
    baseUrl,
    redirectTo,
    requestedIp,
    requestedUserAgent
}) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
        throw new Error('Please enter a valid email address');
    }

    const { token } = await createMagicLink({
        email: normalizedEmail,
        redirectTo,
        requestedIp,
        requestedUserAgent
    });

    const magicLinkUrl = `${publicAppBaseUrl(baseUrl)}/auth/verify?token=${encodeURIComponent(token)}`;
    const emailPayload = buildMagicLinkEmail({
        magicLinkUrl,
        redirectTo
    });

    const { sendEmail } = await import('./oci/emailDelivery.js');
    await sendEmail({
        to: normalizedEmail,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text
    });
}

export async function consumeMagicLink({ token, ipAddress, userAgent }) {
    const tokenHash = hashToken(token);
    const now = new Date();

    const rows = await db
        .select({
            id: authMagicLinks.id,
            userId: authMagicLinks.userId,
            redirectTo: authMagicLinks.redirectTo,
            expiresAt: authMagicLinks.expiresAt,
            consumedAt: authMagicLinks.consumedAt
        })
        .from(authMagicLinks)
        .where(eq(authMagicLinks.tokenHash, tokenHash))
        .limit(1);

    if (rows.length === 0) {
        throw new Error('This sign-in link is invalid or has already been used');
    }

    const link = rows[0];
    if (link.consumedAt || link.expiresAt < now) {
        throw new Error('This sign-in link has expired or has already been used');
    }

    const consumed = await db
        .update(authMagicLinks)
        .set({ consumedAt: now })
        .where(and(eq(authMagicLinks.id, link.id), isNull(authMagicLinks.consumedAt), eq(authMagicLinks.tokenHash, tokenHash)))
        .returning({ id: authMagicLinks.id });

    if (consumed.length === 0) {
        throw new Error('This sign-in link is invalid or has already been used');
    }

    const [updatedUser] = await db
        .update(users)
        .set({
            emailVerifiedAt: now,
            updatedAt: now
        })
        .where(eq(users.id, link.userId))
        .returning({ id: users.id, uuid: users.uuid });

    const { sessionId, expiresAt } = await createSession({
        userId: updatedUser.id,
        ipAddress,
        userAgent
    });

    const issuedAt = Date.now();
    await setSessionCookie(
        signSessionPayload({
            sid: sessionId,
            uid: updatedUser.id,
            uuid: updatedUser.uuid,
            iat: issuedAt,
            exp: expiresAt.getTime(),
            reval: issuedAt
        }),
        expiresAt
    );

    return {
        redirectTo: normalizeRedirectPath(link.redirectTo, '/profile')
    };
}

export async function getSession() {
    const token = await getSessionTokenFromCookies();
    if (!token) return null;

    const payload = verifySessionCookie(token);
    if (!payload) {
        await safeClearSessionCookie();
        return null;
    }

    const now = Date.now();
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
        await safeClearSessionCookie();
        return null;
    }

    if (typeof payload.reval === 'number' && now - payload.reval < SESSION_REVALIDATION_INTERVAL_MS) {
        return {
            user: { id: payload.uid, uuid: payload.uuid },
            session: { id: payload.sid, expiresAt: new Date(payload.exp) }
        };
    }

    const rows = await db
        .select({
            sessionId: authSessions.id,
            userId: users.id,
            userUuid: users.uuid
        })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(
            and(
                eq(authSessions.id, payload.sid),
                isNull(authSessions.revokedAt),
                gt(authSessions.expiresAt, new Date(now))
            )
        )
        .limit(1);

    if (rows.length === 0) {
        await safeClearSessionCookie();
        return null;
    }

    const row = rows[0];
    const refreshedExpiresAt = nowPlus(SESSION_MAX_AGE_MS);

    await db
        .update(authSessions)
        .set({
            expiresAt: refreshedExpiresAt,
            lastSeenAt: new Date(now)
        })
        .where(eq(authSessions.id, row.sessionId));

    const refreshedAt = Date.now();
    await safeSetSessionCookie(
        signSessionPayload({
            sid: row.sessionId,
            uid: row.userId,
            uuid: row.userUuid,
            iat: refreshedAt,
            exp: refreshedExpiresAt.getTime(),
            reval: refreshedAt
        }),
        refreshedExpiresAt
    );

    return {
        user: { id: row.userId, uuid: row.userUuid },
        session: { id: row.sessionId, expiresAt: refreshedExpiresAt }
    };
}

export async function requireUser() {
    const session = await getSession();
    if (!session?.user) {
        throw new Error('Not authenticated');
    }
    return session;
}

export async function logoutCurrentSession() {
    const token = await getSessionTokenFromCookies();
    if (token) {
        const payload = verifySessionCookie(token);
        if (payload?.sid) {
            await deleteSessionById(payload.sid);
        }
    }
    await clearSessionCookie();
}
