import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
    SectionFormFields,
    SectionPreview,
    cssTransformForExifOrientation,
    getSectionPreviews,
    removePendingFileAtIndex
} from '../app/upload/RecipeUploadSection.jsx';

const previewOf = (url, orientation = 1) => ({ url, orientation });

describe('RecipeUploadSection', () => {
    it('renders visible remove controls for each grouped image preview', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionPreview, {
                recipeId: 'section-fp-1',
                fileNames: ['one.jpg', 'two.jpg'],
                previews: [previewOf('data:image/jpeg;base64,AAA'), previewOf('data:image/jpeg;base64,BBB')],
                removeDisabled: false,
                onRemoveImageAtIndex: vi.fn()
            })
        );

        expect(markup).toContain('aria-label="Remove image one.jpg"');
        expect(markup).toContain('aria-label="Remove image two.jpg"');
        expect(markup).not.toContain('>Remove image<');
    });

    it('renders the embedded-thumbnail data URL as the preview image', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionPreview, {
                recipeId: 'section-fp-1',
                fileNames: ['one.jpg'],
                previews: [previewOf('data:image/jpeg;base64,/9j/THUMB')],
                removeDisabled: false,
                onRemoveImageAtIndex: vi.fn()
            })
        );

        expect(markup).toContain('src="data:image/jpeg;base64,/9j/THUMB"');
    });

    it('rotates the preview image to match the JPEG EXIF orientation', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionPreview, {
                recipeId: 'section-fp-1',
                fileNames: ['portrait.jpg'],
                previews: [previewOf('data:image/jpeg;base64,/9j/THUMB', 8)],
                removeDisabled: false,
                onRemoveImageAtIndex: vi.fn()
            })
        );

        expect(markup).toContain('rotate(270deg)');
    });

    it('shows an unavailable notice when a grouped file has no embedded thumbnail', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionPreview, {
                recipeId: 'section-fp-1',
                fileNames: ['one.jpg'],
                previews: [previewOf(null)],
                removeDisabled: false,
                onRemoveImageAtIndex: vi.fn()
            })
        );

        expect(markup).toContain('Preview unavailable.');
    });

    it('derives section previews from each file\'s extracted thumbnail and orientation', () => {
        const files = [
            { name: 'one.jpg', previewDataUrl: 'data:image/jpeg;base64,AAA', previewOrientation: 8 },
            { name: 'two.jpg' },
            null
        ];

        expect(getSectionPreviews(files)).toEqual([
            { url: 'data:image/jpeg;base64,AAA', orientation: 8 },
            { url: null, orientation: 1 },
            { url: null, orientation: 1 }
        ]);
    });

    it('returns an empty list of previews when a section has no files', () => {
        expect(getSectionPreviews([])).toEqual([]);
        expect(getSectionPreviews(undefined)).toEqual([]);
    });

    it('maps EXIF orientation values to CSS transforms', () => {
        expect(cssTransformForExifOrientation(1)).toBe('');
        expect(cssTransformForExifOrientation(3)).toBe('rotate(180deg)');
        expect(cssTransformForExifOrientation(6)).toBe('rotate(90deg)');
        expect(cssTransformForExifOrientation(8)).toBe('rotate(270deg)');
        expect(cssTransformForExifOrientation(2)).toBe('scaleX(-1)');
        expect(cssTransformForExifOrientation(undefined)).toBe('');
        expect(cssTransformForExifOrientation(99)).toBe('');
    });

    it('removes the targeted file from a section', () => {
        const files = [
            { name: 'one.jpg' },
            { name: 'two.jpg' },
            { name: 'three.jpg' }
        ];

        expect(removePendingFileAtIndex(files, 1)).toEqual([
            { name: 'one.jpg' },
            { name: 'three.jpg' }
        ]);
    });

    it('hides creation metadata fields when attaching to an existing recipe', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionFormFields, {
                author: 'Ian',
                name: 'Recipe A',
                notes: 'notes',
                sourceUrl: 'https://example.com',
                mode: 'attach',
                disabled: false,
                buttonLabel: 'Attach 2 images',
                isSubmitDisabled: false,
                onAuthorChange: vi.fn(),
                onNameChange: vi.fn(),
                onNotesChange: vi.fn(),
                onSourceUrlChange: vi.fn(),
                onSubmit: vi.fn()
            })
        );

        expect(markup).not.toContain('Author Name');
        expect(markup).not.toContain('Recipe Name');
        expect(markup).not.toContain('Notes');
        expect(markup).not.toContain('Source Link');
        expect(markup).toContain('>Attach 2 images<');
    });
});
