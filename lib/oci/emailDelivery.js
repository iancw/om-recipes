import * as common from 'oci-common';
import { Buffer } from 'node:buffer';

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} env var`);
    return value;
}

function getAuthProviderFromEnv() {
    const tenancyId = requireEnv('OCI_TENANCY_OCID');
    const userId = requireEnv('OCI_USER_OCID');
    const fingerprint = requireEnv('OCI_FINGERPRINT');
    const privateKeyB64 = requireEnv('OCI_PRIVATE_KEY_B64');
    const regionId = requireEnv('OCI_REGION');
    const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8').trim();

    return new common.SimpleAuthenticationDetailsProvider(
        tenancyId,
        userId,
        fingerprint,
        privateKey,
        null,
        common.Region.fromRegionId(regionId)
    );
}

function normalizeEmailDeliveryEndpoint() {
    let raw = requireEnv('OCI_EMAIL_DELIVERY_ENDPOINT').trim();
    if (!raw) {
        throw new Error('Missing OCI_EMAIL_DELIVERY_ENDPOINT env var');
    }

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        raw = `https://${raw}`;
    }

    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(
            'OCI_EMAIL_DELIVERY_ENDPOINT must be an absolute HTTPS URL, for example https://.../20220926'
        );
    }

    if (url.protocol !== 'https:') {
        throw new Error('OCI_EMAIL_DELIVERY_ENDPOINT must use https://');
    }

    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = /\/\d{8}$/.test(path) ? path : `${path || ''}/20220926`;
    return url.toString().replace(/\/+$/, '');
}

export async function sendEmail({
    to,
    subject,
    html,
    text,
    headers,
    sender = process.env.OCI_EMAIL_SENDER,
    compartmentId = process.env.OCI_EMAIL_DELIVERY_COMPARTMENT_OCID
}) {
    if (!to) throw new Error('Missing recipient email address');
    if (!subject) throw new Error('Missing email subject');
    if (!html && !text) throw new Error('Missing email body');
    if (!sender) throw new Error('Missing OCI_EMAIL_SENDER env var');
    if (!compartmentId) throw new Error('Missing OCI_EMAIL_DELIVERY_COMPARTMENT_OCID env var');

    const provider = getAuthProviderFromEnv();
    const signer = new common.DefaultRequestSigner(provider);
    const httpClient = new common.FetchHttpClient(signer);
    const endpoint = normalizeEmailDeliveryEndpoint();

    const payload = JSON.stringify({
        sender: {
            compartmentId,
            senderAddress: {
                email: sender,
            }
        },
        recipients: {
            to: [{ email: to }]
        },
        subject,
        bodyHtml: html || undefined,
        bodyText: text || undefined,
        headerFields: headers && Object.keys(headers).length > 0 ? headers : undefined
    }, null, 2);

    let response;
    try {
        response = await httpClient.send({
            method: 'POST',
            uri: `${endpoint}/actions/submitEmail`,
            headers: new Headers({
                'content-type': 'application/json'
            }),
            body: payload
        });
    } catch (error) {
        const message = String(error?.message ?? error ?? '');
        if (message.includes('Cannot parse host from url')) {
            throw new Error(
                'OCI email delivery endpoint is invalid. Set OCI_EMAIL_DELIVERY_ENDPOINT to a full HTTPS URL.'
            );
        }
        throw error;
    }

    if (!response.ok) {
        const body = await response.text();

        throw new Error(`OCI email delivery failed (${response.status}): ${body || 'empty response'}`);
    }

    return response;
}
