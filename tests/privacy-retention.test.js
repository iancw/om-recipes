import { describe, expect, it } from 'vitest';
import { getPrivacyRetentionConfig } from '../lib/privacy-retention.js';

describe('privacy retention config', () => {
    it('returns defaults when env vars are absent', () => {
        const config = getPrivacyRetentionConfig({});

        expect(config.magicLinkRetentionDays).toBe(7);
        expect(config.sessionRetentionDays).toBe(30);
        expect(config.exportArtifactRetentionHours).toBe(24);
        expect(config.privacyRequestAuditRetentionDays).toBe(30);
        expect(config.abandonedUploadRetentionHours).toBe(24);
        expect(config.notificationRetentionDays).toBe(90);
    });

    it('parses configured override values', () => {
        const config = getPrivacyRetentionConfig({
            AUTH_MAGIC_LINK_RETENTION_DAYS: '10',
            AUTH_SESSION_RETENTION_DAYS: '45',
            PRIVACY_EXPORT_RETENTION_HOURS: '48',
            PRIVACY_REQUEST_AUDIT_RETENTION_DAYS: '60',
            ABANDONED_UPLOAD_RETENTION_HOURS: '72',
            NOTIFICATION_RETENTION_DAYS: '120'
        });

        expect(config.magicLinkRetentionDays).toBe(10);
        expect(config.sessionRetentionDays).toBe(45);
        expect(config.exportArtifactRetentionHours).toBe(48);
        expect(config.privacyRequestAuditRetentionDays).toBe(60);
        expect(config.abandonedUploadRetentionHours).toBe(72);
        expect(config.notificationRetentionDays).toBe(120);
    });

    it('rejects invalid values', () => {
        expect(() => getPrivacyRetentionConfig({ PRIVACY_EXPORT_RETENTION_HOURS: '0' })).toThrow(
            'PRIVACY_EXPORT_RETENTION_HOURS must be a positive integer'
        );
    });
});
