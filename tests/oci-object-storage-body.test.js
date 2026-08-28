import { describe, it, expect } from 'vitest';
import { readObjectStorageBodyToBuffer } from '../lib/oci/objectStorage.js';

describe('readObjectStorageBodyToBuffer', () => {
    it('reads a body exposing arrayBuffer()', async () => {
        const response = { value: { arrayBuffer: async () => new TextEncoder().encode('hello').buffer } };
        const buf = await readObjectStorageBodyToBuffer(response);
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.toString('utf8')).toBe('hello');
    });

    it('reads a Buffer body', async () => {
        const buf = await readObjectStorageBodyToBuffer({ body: Buffer.from('abc') });
        expect(buf.toString('utf8')).toBe('abc');
    });

    it('reads an async-iterable body', async () => {
        async function* chunks() {
            yield Buffer.from('ab');
            yield Buffer.from('cd');
        }
        const buf = await readObjectStorageBodyToBuffer({ value: chunks() });
        expect(buf.toString('utf8')).toBe('abcd');
    });

    it('accepts the raw response as the body itself', async () => {
        const buf = await readObjectStorageBodyToBuffer(Buffer.from('xyz'));
        expect(buf.toString('utf8')).toBe('xyz');
    });

    it('throws on an empty body', async () => {
        await expect(readObjectStorageBodyToBuffer({})).rejects.toThrow('empty');
    });

    it('throws on an unsupported body type', async () => {
        await expect(readObjectStorageBodyToBuffer({ value: 42 })).rejects.toThrow('Unsupported');
    });
});
