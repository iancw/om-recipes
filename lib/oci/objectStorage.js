import * as common from 'oci-common';
import * as objectstorage from 'oci-objectstorage';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';

const REQUIRED_OBJECT_STORAGE_ENV_VARS = [
    'OCI_TENANCY_OCID',
    'OCI_USER_OCID',
    'OCI_FINGERPRINT',
    'OCI_PRIVATE_KEY_B64',
    'OCI_REGION',
    'OCI_OBJECT_STORAGE_NAMESPACE'
];

export function getMissingObjectStorageEnvVars(env = process.env) {
    return REQUIRED_OBJECT_STORAGE_ENV_VARS.filter((name) => !env[name]);
}

/**
 * Create an OCI Object Storage client using API key credentials from env vars.
 *
 * Required env vars:
 * - OCI_TENANCY_OCID
 * - OCI_USER_OCID
 * - OCI_FINGERPRINT
 * - OCI_PRIVATE_KEY_B64 (base64-encoded PEM)
 * - OCI_REGION
 * - OCI_OBJECT_STORAGE_NAMESPACE
 */
export function getObjectStorageClientFromEnv(env = process.env) {
    const tenancyId = env.OCI_TENANCY_OCID;
    const userId = env.OCI_USER_OCID;
    const fingerprint = env.OCI_FINGERPRINT;
    const privateKeyB64 = env.OCI_PRIVATE_KEY_B64;
    const regionId = env.OCI_REGION;

    if (!tenancyId || !userId || !fingerprint || !privateKeyB64 || !regionId) {
        throw new Error(
            'Missing OCI env vars. Need OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_PRIVATE_KEY_B64, OCI_REGION'
        );
    }

    // Decode into the PEM text expected by the OCI SDK.
    const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8').trim();

    const provider = new common.SimpleAuthenticationDetailsProvider(
        tenancyId,
        userId,
        fingerprint,
        privateKey,
        null,
        common.Region.fromRegionId(regionId)
    );

    const client = new objectstorage.ObjectStorageClient({ authenticationDetailsProvider: provider });
    client.region = common.Region.fromRegionId(regionId);
    return client;
}

export function getObjectStorageNamespaceFromEnv(env = process.env) {
    const ns = env.OCI_OBJECT_STORAGE_NAMESPACE;
    if (!ns) throw new Error('Missing OCI_OBJECT_STORAGE_NAMESPACE env var');
    return ns;
}

export async function putObject({ client, namespaceName, bucketName, objectName, contentType, body }) {
    return client.putObject({
        namespaceName,
        bucketName,
        objectName,
        contentType,
        putObjectBody: body
    });
}

export async function putObjectFromFile({
    client,
    namespaceName,
    bucketName,
    objectName,
    filePath,
    contentType = 'application/octet-stream'
}) {
    return putObject({
        client,
        namespaceName,
        bucketName,
        objectName,
        contentType,
        body: fs.createReadStream(filePath)
    });
}

export async function headObject({ client, namespaceName, bucketName, objectName }) {
    return client.headObject({
        namespaceName,
        bucketName,
        objectName
    });
}

export async function getObject({ client, namespaceName, bucketName, objectName }) {
    return client.getObject({
        namespaceName,
        bucketName,
        objectName
    });
}

/**
 * Create a short-lived Pre-Authenticated Request (PAR) for a single object.
 *
 * This is intended for browser direct uploads (ObjectWrite). The returned URL
 * can be used as the target of a PUT request.
 */
export async function createPreauthenticatedRequest({
    client,
    namespaceName,
    bucketName,
    objectName,
    accessType = 'ObjectWrite',
    expiresAt,
    name
}) {
    const regionId = process.env.OCI_REGION;
    if (!regionId) throw new Error('Missing OCI_REGION env var');
    if (!expiresAt) throw new Error('Missing expiresAt');

    const createDetails = {
        name: name || `par-${Date.now()}`,
        accessType,
        objectName,
        timeExpires: expiresAt
    };

    const res = await client.createPreauthenticatedRequest({
        namespaceName,
        bucketName,
        createPreauthenticatedRequestDetails: createDetails
    });

    const accessUri = res?.preauthenticatedRequest?.accessUri;
    if (!accessUri) throw new Error('OCI PAR creation succeeded but accessUri was missing');

    // accessUri is like: /p/<token>/n/<ns>/b/<bucket>/o/<object>
    return `https://objectstorage.${regionId}.oraclecloud.com${accessUri}`;
}

export async function deleteObject({ client, namespaceName, bucketName, objectName }) {
    return client.deleteObject({
        namespaceName,
        bucketName,
        objectName
    });
}
