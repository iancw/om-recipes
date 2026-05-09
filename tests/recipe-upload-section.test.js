import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
    SectionFormFields,
    SectionPreview,
    removePendingFileAtIndex
} from '../app/upload/RecipeUploadSection.jsx';

describe('RecipeUploadSection', () => {
    it('renders visible remove controls for each grouped image preview', () => {
        const markup = renderToStaticMarkup(
            React.createElement(SectionPreview, {
                recipeId: 'section-fp-1',
                fileNames: ['one.jpg', 'two.jpg'],
                previewUrls: ['blob:one', 'blob:two'],
                disablePreview: false,
                isPreparingPreview: false,
                removeDisabled: false,
                onRemoveImageAtIndex: vi.fn()
            })
        );

        expect(markup).toContain('aria-label="Remove image one.jpg"');
        expect(markup).toContain('aria-label="Remove image two.jpg"');
        expect(markup).not.toContain('>Remove image<');
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
