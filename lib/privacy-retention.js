const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function parsePositiveInteger(value, fallback, label) {
    if (value == null || value === '') return fallback;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }

    return parsed;
}

export function getPrivacyRetentionConfig(env = process.env) {
    const magicLinkRetentionDays = parsePositiveInteger(
        env.AUTH_MAGIC_LINK_RETENTION_DAYS,
        7,
        'AUTH_MAGIC_LINK_RETENTION_DAYS'
    );
    const sessionRetentionDays = parsePositiveInteger(
        env.AUTH_SESSION_RETENTION_DAYS,
        30,
        'AUTH_SESSION_RETENTION_DAYS'
    );
    const exportArtifactRetentionHours = parsePositiveInteger(
        env.PRIVACY_EXPORT_RETENTION_HOURS,
        24,
        'PRIVACY_EXPORT_RETENTION_HOURS'
    );
    const privacyRequestAuditRetentionDays = parsePositiveInteger(
        env.PRIVACY_REQUEST_AUDIT_RETENTION_DAYS,
        30,
        'PRIVACY_REQUEST_AUDIT_RETENTION_DAYS'
    );
    const abandonedUploadRetentionHours = parsePositiveInteger(
        env.ABANDONED_UPLOAD_RETENTION_HOURS,
        24,
        'ABANDONED_UPLOAD_RETENTION_HOURS'
    );
    const notificationRetentionDays = parsePositiveInteger(
        env.NOTIFICATION_RETENTION_DAYS,
        90,
        'NOTIFICATION_RETENTION_DAYS'
    );

    return {
        magicLinkRetentionDays,
        sessionRetentionDays,
        exportArtifactRetentionHours,
        privacyRequestAuditRetentionDays,
        abandonedUploadRetentionHours,
        notificationRetentionDays,
        magicLinkRetentionMs: magicLinkRetentionDays * DAY_MS,
        sessionRetentionMs: sessionRetentionDays * DAY_MS,
        exportArtifactRetentionMs: exportArtifactRetentionHours * HOUR_MS,
        privacyRequestAuditRetentionMs: privacyRequestAuditRetentionDays * DAY_MS,
        abandonedUploadRetentionMs: abandonedUploadRetentionHours * HOUR_MS,
        notificationRetentionMs: notificationRetentionDays * DAY_MS
    };
}
