import { describe, expect, it } from 'vitest';

import { buildUploadSections } from '../app/upload/group-upload-candidates.js';

describe('buildUploadSections', () => {
    it('groups files with the same exact fingerprint into one section', () => {
        const recipe = { hasColorProfileSettings: true, yellow: 1, blue: -1 };
        const candidates = [
            {
                id: 'a',
                fileName: 'one.jpg',
                status: 'parsed',
                recipeSettings: recipe,
                exactFingerprint: 'fp-1'
            },
            {
                id: 'b',
                fileName: 'two.jpg',
                status: 'parsed',
                recipeSettings: recipe,
                exactFingerprint: 'fp-1'
            }
        ];

        const result = buildUploadSections(candidates, { initialAuthor: 'Ian' });

        expect(result.sections).toHaveLength(1);
        expect(result.sections[0]).toMatchObject({
            exactFingerprint: 'fp-1',
            fileIds: ['a', 'b'],
            form: {
                author: 'Ian',
                name: 'one',
                notes: '',
                sourceUrl: ''
            }
        });
    });

    it('splits files from different exact fingerprints into separate sections', () => {
        const result = buildUploadSections(
            [
                { id: 'a', fileName: 'one.jpg', status: 'parsed', recipeSettings: { yellow: 1 }, exactFingerprint: 'fp-1' },
                { id: 'b', fileName: 'two.jpg', status: 'parsed', recipeSettings: { yellow: 2 }, exactFingerprint: 'fp-2' }
            ],
            { initialAuthor: 'Ian' }
        );

        expect(result.sections.map((section) => section.exactFingerprint)).toEqual(['fp-1', 'fp-2']);
    });

    it('keeps invalid files out of valid sections', () => {
        const result = buildUploadSections(
            [
                { id: 'a', fileName: 'ok.jpg', status: 'parsed', recipeSettings: { yellow: 1 }, exactFingerprint: 'fp-1' },
                { id: 'b', fileName: 'bad.jpg', status: 'invalid', error: 'No recipe found' }
            ],
            { initialAuthor: 'Ian' }
        );

        expect(result.sections).toHaveLength(1);
        expect(result.invalidFiles).toEqual([
            expect.objectContaining({ id: 'b', fileName: 'bad.jpg', error: 'No recipe found' })
        ]);
    });
});
