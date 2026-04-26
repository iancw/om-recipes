import { describe, expect, it } from 'vitest';

import { getUploadProgressMessage } from '../lib/upload-status.js';

describe('getUploadProgressMessage', () => {
    it('describes the preparing phase', () => {
        expect(getUploadProgressMessage('preparing')).toEqual({
            title: 'Preparing upload…',
            body: 'Validating the recipe details and preparing the image upload.'
        });
    });

    it('describes the direct upload phase', () => {
        expect(getUploadProgressMessage('direct-upload')).toEqual({
            title: 'Uploading JPG to storage…',
            body: 'Sending the original JPG to storage before it can be attached to the recipe.'
        });
    });

    it('describes the finalizing phase', () => {
        expect(getUploadProgressMessage('finalizing')).toEqual({
            title: 'Finalizing recipe upload…',
            body: 'Attaching the image to the recipe and finishing server-side processing.'
        });
    });

    it('falls back to a generic upload message for unknown phases', () => {
        expect(getUploadProgressMessage('something-else')).toEqual({
            title: 'Uploading…',
            body: 'Working through the upload now.'
        });
    });
});
