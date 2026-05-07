import * as common from 'oci-common';
import * as functions from 'oci-functions';
import { Buffer } from 'node:buffer';

function requireEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing ${name} env var`);
    return v;
}

export function getFunctionsInvokeClientFromEnv() {
    const tenancyId = process.env.OCI_TENANCY_OCID;
    const userId = process.env.OCI_USER_OCID;
    const fingerprint = process.env.OCI_FINGERPRINT;
    const privateKeyB64 = process.env.OCI_PRIVATE_KEY_B64;
    const regionId = process.env.OCI_REGION;
    const endpoint = process.env.OCI_FUNCTIONS_INVOKE_ENDPOINT;

    if (!tenancyId || !userId || !fingerprint || !privateKeyB64 || !regionId) {
        throw new Error(
            'Missing OCI env vars. Need OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_PRIVATE_KEY_B64, OCI_REGION'
        );
    }
    if (!endpoint) throw new Error('Missing OCI_FUNCTIONS_INVOKE_ENDPOINT env var');

    const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8').trim();

    const provider = new common.SimpleAuthenticationDetailsProvider(
        tenancyId,
        userId,
        fingerprint,
        privateKey,
        null,
        common.Region.fromRegionId(regionId)
    );

    const client = new functions.FunctionsInvokeClient({ authenticationDetailsProvider: provider });
    client.endpoint = endpoint;
    return client;
}

const SAFE_PREVIEW_LIMIT = 512;

function trimPreview(value) {
    if (!value) return '';
    if (value.length <= SAFE_PREVIEW_LIMIT) return value;
    return `${value.slice(0, SAFE_PREVIEW_LIMIT)}…`;
}

function formatDecodedPreview(decoded) {
    if (!decoded) return '';
    const preview = decoded.preview ?? '';
    const typeLabel = decoded.type;
    if (!preview) {
        if (!typeLabel || typeLabel === 'null') return '';
        return `[type=${typeLabel}]`;
    }
    return typeLabel ? `${preview} [type=${typeLabel}]` : preview;
}

async function readNodeStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('end', () => {
            const combined = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
            resolve(combined.toString('utf8'));
        });
        stream.on('error', reject);
    });
}

async function readWhatwgStream(useResponse, stream) {
    if (useResponse && typeof Response === 'function') {
        return new Response(stream).text();
    }

    const reader = stream.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
        }
    }
    const combined = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    return combined.toString('utf8');
}

async function safeDecodeResponseBody(body) {
    if (body == null) return { text: '', preview: '', type: 'null' };

    if (typeof body === 'string') {
        return { text: body, preview: trimPreview(body), type: 'string' };
    }

    if (body instanceof Error) {
        const text = body.message ?? '';
        return { text, preview: trimPreview(text), type: body.name ?? 'Error' };
    }

    if (Buffer.isBuffer(body)) {
        const text = body.toString('utf8');
        return { text, preview: trimPreview(text), type: 'Buffer' };
    }

    if (body instanceof Uint8Array) {
        const text = Buffer.from(body).toString('utf8');
        return { text, preview: trimPreview(text), type: 'Uint8Array' };
    }

    if (typeof body?.text === 'function') {
        const text = await body.text();
        return { text, preview: trimPreview(text), type: body.constructor?.name ?? 'Body' };
    }

    if (typeof body?.getReader === 'function') {
        const text = await readWhatwgStream(typeof Response === 'function', body);
        return { text, preview: trimPreview(text), type: body.constructor?.name ?? 'ReadableStream' };
    }

    if (typeof body?.on === 'function') {
        const text = await readNodeStream(body);
        return { text, preview: trimPreview(text), type: body.constructor?.name ?? 'Readable' };
    }

    if (typeof body === 'object') {
        let text = '';
        try {
            text = JSON.stringify(body);
        } catch (err) {
            text = String(body);
        }
        return { text, preview: trimPreview(text), type: body.constructor?.name ?? 'object' };
    }

    const text = String(body);
    return { text, preview: trimPreview(text), type: typeof body };
}

class NormalizedInvokeError extends Error {
    constructor({ message, errorType, functionId, objectName, details, preview, cause }) {
        super(message);
        if (cause) this.cause = cause;
        this.name = 'NormalizedInvokeError';
        this.errorType = errorType;
        this.functionId = functionId;
        this.objectName = objectName;
        this.details = details ?? null;
        this.preview = preview ?? '';
    }
}

function buildNormalizedMessage(baseMessage, functionId, objectName, preview) {
    const context = `${baseMessage} (functionId=${functionId}, objectName=${objectName})`;
    if (!preview) return `${context}: `;
    return `${context}: ${preview}`;
}

function ensurePreview(decoded, fallback) {
    const preview = formatDecodedPreview(decoded);
    if (preview) return preview;
    const fallbackPreview = trimPreview(String(fallback ?? ''));
    return fallbackPreview || '';
}

function createNormalizedInvokeError({ errorType, baseMessage, functionId, objectName, preview, details, cause }) {
    const previewValue = preview ?? '';
    const message = buildNormalizedMessage(baseMessage, functionId, objectName, previewValue);
    return new NormalizedInvokeError({
        message,
        errorType,
        functionId,
        objectName,
        details,
        preview: previewValue,
        cause
    });
}

function firstNumericValue(values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

function hasSdkInvokeSuccessShape(res) {
    return Boolean(res && (res.value != null || res.opcRequestId != null));
}

function getInvokeResponseStatus(res) {
    const explicitStatus = firstNumericValue([
        res?.response?.status,
        res?.response?.statusCode,
        res?.statusCode,
        res?.status
    ]);
    if (explicitStatus != null) return explicitStatus;

    if (hasSdkInvokeSuccessShape(res)) return 200;
    return null;
}

function getInvokeResponseBody(res) {
    if (res?.data != null) return res.data;
    if (res?.value != null) return res.value;
    if (res?.response?.data != null) return res.response.data;
    return null;
}

export async function invokeImageResizeFunction({ sourceBucket, objectName, objectNames, destinationBucket, timeoutMs }) {
    const functionId = requireEnv('OCI_IMAGE_RESIZE_FUNCTION_ID');
    const client = getFunctionsInvokeClientFromEnv();
    const normalizedObjectNames = Array.isArray(objectNames) ? objectNames : null;
    const objectNameForContext = objectName || normalizedObjectNames?.[0] || '<unknown>';

    if (!sourceBucket) throw new Error('Missing sourceBucket');
    if (objectName && normalizedObjectNames?.length) {
        throw new Error('Provide either objectName or objectNames, not both');
    }
    if (!objectName && !normalizedObjectNames?.length) {
        throw new Error('Missing objectName or objectNames');
    }

    const payload = {
        sourceBucket,
        ...(objectName ? { objectName } : {}),
        ...(normalizedObjectNames?.length ? { objectNames: normalizedObjectNames } : {}),
        ...(destinationBucket ? { destinationBucket } : {}),
        data: {
            resourceName: objectNameForContext,
            additionalDetails: {
                bucketName: sourceBucket,
                objectName: objectNameForContext
            }
        }
    };

    const body = JSON.stringify(payload);
    const opts = {};
    if (timeoutMs != null) opts.timeout = timeoutMs;

    let res;
    try {
        res = await client.invokeFunction(
            {
                functionId,
                invokeFunctionBody: body
            },
            opts
        );
    } catch (err) {
        const decodedErr = await safeDecodeResponseBody(err);
        const preview = ensurePreview(decodedErr, err?.message ?? err);
        const details = {
            decoded: decodedErr
        };
        if (err && typeof err === 'object') {
            if ('metadata' in err) details.metadata = err.metadata;
            if (err.cause) details.cause = err.cause;
        }
        throw createNormalizedInvokeError({
            errorType: 'invoke_error',
            baseMessage: 'OCI function invoke failed',
            functionId,
            objectName: objectNameForContext,
            preview,
            details,
            cause: err
        });
    }

    const status = getInvokeResponseStatus(res);
    const decoded = await safeDecodeResponseBody(getInvokeResponseBody(res));
    const raw = decoded.text;

    if (status == null) {
        throw createNormalizedInvokeError({
            errorType: 'missing_status',
            baseMessage: 'OCI function invoke returned no status',
            functionId,
            objectName: objectNameForContext,
            preview: ensurePreview(decoded),
            details: {
                responseKeys: res && typeof res === 'object' ? Object.keys(res) : [],
                decoded
            }
        });
    }
    if (status < 200 || status >= 300) {
        const errorPreview = ensurePreview(decoded);
        throw createNormalizedInvokeError({
            errorType: 'non-2xx',
            baseMessage: `OCI function invoke non-2xx (status=${status})`,
            functionId,
            objectName: objectNameForContext,
            preview: errorPreview,
            details: { status, decoded }
        });
    }

    let parsed;
    try {
        parsed = raw ? JSON.parse(raw) : null;
    } catch (err) {
        const invalidPreview = ensurePreview(decoded, err?.message ?? err);
        throw createNormalizedInvokeError({
            errorType: 'invalid_json',
            baseMessage: 'OCI function invoke returned invalid JSON',
            functionId,
            objectName: objectNameForContext,
            preview: invalidPreview,
            details: {
                decoded,
                parseError: err instanceof Error ? err.message : String(err ?? '')
            },
            cause: err
        });
    }

    if (parsed && parsed.ok === false) {
        const okPreview = ensurePreview(decoded);
        const details = {
            parsed,
            decoded
        };
        if (parsed.error) {
            details.error = parsed.error;
        }
        throw createNormalizedInvokeError({
            errorType: 'ok:false',
            baseMessage: 'OCI image resize function reported ok:false',
            functionId,
            objectName: objectNameForContext,
            preview: okPreview,
            details
        });
    }

    return parsed;
}

export async function warmImageResizeFunction() {
    const functionId = requireEnv('OCI_IMAGE_RESIZE_FUNCTION_ID');
    const client = getFunctionsInvokeClientFromEnv();

    try {
        await client.invokeFunction({
            functionId,
            invokeFunctionBody: '{}'
        });
    } catch {
        // Warm-up failures are expected and silently ignored.
    }
}
