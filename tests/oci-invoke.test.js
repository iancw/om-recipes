import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

vi.mock('oci-common', () => {
    class SimpleAuthenticationDetailsProvider {
        constructor(...args) {
            this.args = args;
        }
    }
    const Region = {
        fromRegionId: (id) => ({ regionId: id })
    };
    return { SimpleAuthenticationDetailsProvider, Region };
});

vi.mock('oci-functions', () => {
    class FunctionsInvokeClient {
        constructor(opts) {
            this.opts = opts;
            this.endpoint = undefined;
        }

        invokeFunction() {
            throw new Error('invokeFunction not stubbed');
        }
    }
    return { FunctionsInvokeClient };
});

const ENV_KEYS = [
    'OCI_TENANCY_OCID',
    'OCI_USER_OCID',
    'OCI_FINGERPRINT',
    'OCI_PRIVATE_KEY_B64',
    'OCI_REGION',
    'OCI_FUNCTIONS_INVOKE_ENDPOINT',
    'OCI_PROCESS_IMAGE_FUNCTION_ID',
    'OCI_IMAGE_RESIZE_FUNCTION_ID'
];

function setValidEnv() {
    process.env.OCI_TENANCY_OCID = 'ocid1.tenancy.oc1..aaaa';
    process.env.OCI_USER_OCID = 'ocid1.user.oc1..bbbb';
    process.env.OCI_FINGERPRINT = '11:22:33';
    process.env.OCI_PRIVATE_KEY_B64 = Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----').toString(
        'base64'
    );
    process.env.OCI_REGION = 'us-poenix-1';
    process.env.OCI_FUNCTIONS_INVOKE_ENDPOINT = 'https://functions.example.com';
    process.env.OCI_PROCESS_IMAGE_FUNCTION_ID = 'ocid1.fnfunc.oc1..dddd';
    process.env.OCI_IMAGE_RESIZE_FUNCTION_ID = 'ocid1.fnfunc.oc1..cccc';
}

function clearEnv() {
    for (const k of ENV_KEYS) delete process.env[k];
}

describe('lib/oci/functionsInvoke', () => {
    beforeEach(() => {
        clearEnv();
        vi.resetModules();
    });

    afterEach(() => {
        clearEnv();
        vi.restoreAllMocks();
    });

    it('throws clear error when auth env missing', async () => {
        process.env.OCI_FUNCTIONS_INVOKE_ENDPOINT = 'https://functions.example.com';
        process.env.OCI_IMAGE_RESIZE_FUNCTION_ID = 'ocid1.fnfunc.oc1..cccc';

        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        await expect(
            invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg', destinationBucket: 'dst' })
        ).rejects.toThrow(/Missing OCI env vars\./);
    });

    it('throws clear error when invoke endpoint env missing', async () => {
        setValidEnv();
        delete process.env.OCI_FUNCTIONS_INVOKE_ENDPOINT;
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');

        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            'Missing OCI_FUNCTIONS_INVOKE_ENDPOINT env var'
        );
    });

    it('throws clear error when function id env missing', async () => {
        setValidEnv();
        delete process.env.OCI_PROCESS_IMAGE_FUNCTION_ID;
        delete process.env.OCI_IMAGE_RESIZE_FUNCTION_ID;
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');

        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            'Missing OCI_PROCESS_IMAGE_FUNCTION_ID or OCI_IMAGE_RESIZE_FUNCTION_ID env var'
        );
    });

    it('prefers OCI_PROCESS_IMAGE_FUNCTION_ID when both function env vars are set', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });

        const [requestArg] = spy.mock.calls[0];
        expect(requestArg.functionId).toBe('ocid1.fnfunc.oc1..dddd');
    });

    it('falls back to OCI_IMAGE_RESIZE_FUNCTION_ID when the new function env var is absent', async () => {
        setValidEnv();
        delete process.env.OCI_PROCESS_IMAGE_FUNCTION_ID;
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });

        const [requestArg] = spy.mock.calls[0];
        expect(requestArg.functionId).toBe('ocid1.fnfunc.oc1..cccc');
    });

    it('does not expose a warmImageResizeFunction helper', async () => {
        const functionsInvoke = await import('../lib/oci/functionsInvoke.js');

        expect(functionsInvoke).not.toHaveProperty('warmImageResizeFunction');
    });

    it('success: returns parsed JSON on 2xx ok:true', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        const res = await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });
        expect(res).toEqual({ ok: true });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('sends invoke body as JSON string for OCI request signing compatibility', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        await invokeImageResizeFunction({
            sourceBucket: 'src',
            objectName: 'authors/a/recipes/r/image.jpg',
            destinationBucket: 'dst'
        });

        const [requestArg] = spy.mock.calls[0];
        expect(typeof requestArg.invokeFunctionBody).toBe('string');
        const payload = JSON.parse(requestArg.invokeFunctionBody);
        expect(payload).toEqual({
            sourceBucket: 'src',
            objectName: 'authors/a/recipes/r/image.jpg',
            destinationBucket: 'dst',
            data: {
                resourceName: 'authors/a/recipes/r/image.jpg',
                additionalDetails: {
                    bucketName: 'src',
                    objectName: 'authors/a/recipes/r/image.jpg'
                }
            }
        });
    });

    it('omits destinationBucket from the invoke payload when not provided', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        await invokeImageResizeFunction({
            sourceBucket: 'src',
            objectName: 'authors/a/recipes/r/image.jpg'
        });

        const [requestArg] = spy.mock.calls[0];
        const payload = JSON.parse(requestArg.invokeFunctionBody);
        expect(payload).toEqual({
            sourceBucket: 'src',
            objectName: 'authors/a/recipes/r/image.jpg',
            data: {
                resourceName: 'authors/a/recipes/r/image.jpg',
                additionalDetails: {
                    bucketName: 'src',
                    objectName: 'authors/a/recipes/r/image.jpg'
                }
            }
        });
    });

    it('sends objectNames in the invoke payload for batch image migration', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        const spy = vi
            .spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction')
            .mockResolvedValue({ response: { status: 200 }, data: Buffer.from(JSON.stringify({ ok: true })) });

        await invokeImageResizeFunction({
            sourceBucket: 'src',
            objectNames: ['authors/a/recipes/r/one.jpg', 'authors/a/recipes/r/two.jpg'],
            destinationBucket: 'dst'
        });

        const [requestArg] = spy.mock.calls[0];
        expect(JSON.parse(requestArg.invokeFunctionBody)).toEqual({
            sourceBucket: 'src',
            objectNames: ['authors/a/recipes/r/one.jpg', 'authors/a/recipes/r/two.jpg'],
            destinationBucket: 'dst',
            data: {
                resourceName: 'authors/a/recipes/r/one.jpg',
                additionalDetails: {
                    bucketName: 'src',
                    objectName: 'authors/a/recipes/r/one.jpg'
                }
            }
        });
    });

    it('rejects batch invoke calls that pass both objectName and objectNames', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');

        await expect(
            invokeImageResizeFunction({
                sourceBucket: 'src',
                objectName: 'authors/a/recipes/r/image.jpg',
                objectNames: ['authors/a/recipes/r/one.jpg']
            })
        ).rejects.toThrow('Provide either objectName or objectNames, not both');
    });

    it('supports OCI SDK invoke responses that only return value/opcRequestId', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockResolvedValue({
            opcRequestId: 'req-123',
            value: Buffer.from(JSON.stringify({ ok: true }))
        });

        const res = await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });
        expect(res).toEqual({ ok: true });
    });

    it('throws on non-2xx status and includes context + body', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockResolvedValue({
            response: { status: 502 },
            data: Buffer.from('bad gateway')
        });

        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            /non-2xx/
        );
        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            /functionId=.*objectName=a\.jpg/
        );
    });

    it('throws on ok:false response and includes function + object context', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockResolvedValue({
            response: { status: 200 },
            data: Buffer.from(JSON.stringify({ ok: false, error: 'resize failed' }))
        });

        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            /ok:false/
        );
        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            /resize failed/
        );
    });

    it('throws on invalid JSON response body', async () => {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockResolvedValue({
            response: { status: 200 },
            data: Buffer.from('{not-json')
        });

        await expect(invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' })).rejects.toThrow(
            /invalid JSON/
        );
    });

    async function getNon2xxErrorForBody(data) {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockResolvedValue({
            response: { status: 502 },
            data
        });

        try {
            await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });
            throw new Error('expected invoke to reject');
        } catch (err) {
            return err;
        }
    }

    async function getErrorForRejection(reason) {
        setValidEnv();
        const { invokeImageResizeFunction } = await import('../lib/oci/functionsInvoke.js');
        const functionsMod = await import('oci-functions');
        vi.spyOn(functionsMod.FunctionsInvokeClient.prototype, 'invokeFunction').mockRejectedValue(reason);

        try {
            await invokeImageResizeFunction({ sourceBucket: 'src', objectName: 'a.jpg' });
            throw new Error('expected invoke to reject');
        } catch (err) {
            return err;
        }
    }

    describe('response-body variant coverage', () => {
        const contextPattern = /functionId=.*objectName=a\.jpg/;

        it('includes decoded string bodies in the non-2xx message', async () => {
            const error = await getNon2xxErrorForBody('string-body-failure');
            expect(error.message).toMatch(/string-body-failure/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('includes decoded Buffer bodies in the non-2xx message', async () => {
            const error = await getNon2xxErrorForBody(Buffer.from('buffer-body-failure'));
            expect(error.message).toMatch(/buffer-body-failure/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('includes decoded Uint8Array bodies in the non-2xx message', async () => {
            const error = await getNon2xxErrorForBody(new Uint8Array(Buffer.from('uint8array-failure')));
            expect(error.message).toMatch(/uint8array-failure/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('includes decoded Node readable streams in the non-2xx message', async () => {
            const stream = Readable.from(['stream-body-failure']);
            const error = await getNon2xxErrorForBody(stream);
            expect(error.message).toMatch(/stream-body-failure/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('includes decoded WHATWG readable streams in the non-2xx message', async () => {
            const encoder = new TextEncoder();
            const whatwgStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('whatwg-body-failure'));
                    controller.close();
                }
            });
            const error = await getNon2xxErrorForBody(whatwgStream);
            expect(error.message).toMatch(/whatwg-body-failure/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('avoids [object Object] when body is a plain object', async () => {
            const payload = { error: 'boom preview', detail: { code: 123 } };
            const error = await getNon2xxErrorForBody(payload);
            expect(error.message).toMatch(/boom preview/);
            expect(error.message).toMatch(/detail.*code.*123/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });

        it('gracefully handles empty bodies', async () => {
            const error = await getNon2xxErrorForBody(null);
            expect(error.message).toMatch(/OCI function invoke non-2xx/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).toMatch(/: $/);
            expect(error.message).not.toContain('[object Object]');
        });

        it('rethrows non-Error rejections without emitting [object Object]', async () => {
            const reason = { detail: 'opaque-rejection', code: 503 };
            const error = await getErrorForRejection(reason);
            expect(error.message).toMatch(/opaque-rejection/);
            expect(error.message).toMatch(/code.*503/);
            expect(error.message).toMatch(/OCI function invoke failed/);
            expect(error.message).toMatch(contextPattern);
            expect(error.message).not.toContain('[object Object]');
        });
    });
});
