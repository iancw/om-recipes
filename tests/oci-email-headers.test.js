import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let capturedBody;

vi.mock('oci-common', () => {
    class SimpleAuthenticationDetailsProvider {
        constructor(...args) {
            this.args = args;
        }
    }
    class DefaultRequestSigner {
        constructor(...args) {
            this.args = args;
        }
    }
    class FetchHttpClient {
        constructor(...args) {
            this.args = args;
        }

        send({ body }) {
            capturedBody = body;
            return Promise.resolve({ ok: true, text: async () => '' });
        }
    }
    const Region = {
        fromRegionId: (id) => ({ regionId: id })
    };
    return { SimpleAuthenticationDetailsProvider, DefaultRequestSigner, FetchHttpClient, Region };
});

const ENV_KEYS = [
    'OCI_TENANCY_OCID',
    'OCI_USER_OCID',
    'OCI_FINGERPRINT',
    'OCI_PRIVATE_KEY_B64',
    'OCI_REGION',
    'OCI_EMAIL_DELIVERY_ENDPOINT',
    'OCI_EMAIL_SENDER',
    'OCI_EMAIL_DELIVERY_COMPARTMENT_OCID'
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

describe('sendEmail optional headers', () => {
    beforeEach(() => {
        capturedBody = undefined;
        process.env.OCI_TENANCY_OCID = 't';
        process.env.OCI_USER_OCID = 'u';
        process.env.OCI_FINGERPRINT = 'f';
        process.env.OCI_PRIVATE_KEY_B64 = Buffer.from('key').toString('base64');
        process.env.OCI_REGION = 'us-ashburn-1';
        process.env.OCI_EMAIL_DELIVERY_ENDPOINT = 'https://email.example.com';
        process.env.OCI_EMAIL_SENDER = 'noreply@example.com';
        process.env.OCI_EMAIL_DELIVERY_COMPARTMENT_OCID = 'compartment';
    });

    afterEach(() => {
        clearEnv();
        vi.restoreAllMocks();
    });

    it('includes a headers field in the submitEmail payload when provided', async () => {
        const { sendEmail } = await import('../lib/oci/emailDelivery.js');
        await sendEmail({
            to: 'user@example.com',
            subject: 'Subject',
            text: 'Body',
            headers: { 'List-Unsubscribe': '<https://example.com/unsub>' }
        });

        const parsed = JSON.parse(capturedBody);
        expect(parsed.headerFields).toEqual({ 'List-Unsubscribe': '<https://example.com/unsub>' });
    });

    it('omits the headers field from the payload when not provided', async () => {
        const { sendEmail } = await import('../lib/oci/emailDelivery.js');
        await sendEmail({
            to: 'user@example.com',
            subject: 'Subject',
            text: 'Body'
        });

        const parsed = JSON.parse(capturedBody);
        expect(parsed.headers).toBeUndefined();
    });
});
