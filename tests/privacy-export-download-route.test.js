import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth.js', () => ({
    getSession: vi.fn()
}));

vi.mock('../lib/privacy.js', () => ({
    getDownloadablePrivacyExport: vi.fn()
}));

import { getSession } from '../lib/auth.js';
import { getDownloadablePrivacyExport } from '../lib/privacy.js';
import { GET as downloadPrivacyExport } from '../app/profile/privacy-requests/[requestId]/download/route.js';

describe('privacy export download route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('requires authentication', async () => {
        vi.mocked(getSession).mockResolvedValue(null);

        const response = await downloadPrivacyExport(null, {
            params: Promise.resolve({ requestId: '11111111-1111-1111-1111-111111111111' })
        });

        expect(response.status).toBe(401);
        expect(getDownloadablePrivacyExport).not.toHaveBeenCalled();
    });

    it('rejects a request id that is not a uuid, including a guessable sequential integer', async () => {
        vi.mocked(getSession).mockResolvedValue({ user: { id: 5 } });

        const response = await downloadPrivacyExport(null, {
            params: Promise.resolve({ requestId: '22' })
        });

        expect(response.status).toBe(400);
        expect(getDownloadablePrivacyExport).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the uuid and the authenticated user, returning 404 when it does not match', async () => {
        vi.mocked(getSession).mockResolvedValue({ user: { id: 5 } });
        vi.mocked(getDownloadablePrivacyExport).mockResolvedValue(null);

        const otherUsersRequestUuid = '99999999-9999-9999-9999-999999999999';
        const response = await downloadPrivacyExport(null, {
            params: Promise.resolve({ requestId: otherUsersRequestUuid })
        });

        expect(getDownloadablePrivacyExport).toHaveBeenCalledWith({
            requestUuid: otherUsersRequestUuid,
            userId: 5
        });
        expect(response.status).toBe(404);
    });

    it('streams the artifact back for a matching export owned by the caller', async () => {
        vi.mocked(getSession).mockResolvedValue({ user: { id: 5 } });
        vi.mocked(getDownloadablePrivacyExport).mockResolvedValue({
            buffer: Buffer.from('zip-bytes'),
            contentType: 'application/zip',
            fileName: 'om-recipes-export.zip'
        });

        const response = await downloadPrivacyExport(null, {
            params: Promise.resolve({ requestId: '11111111-1111-1111-1111-111111111111' })
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/zip');
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="om-recipes-export.zip"');
    });
});
