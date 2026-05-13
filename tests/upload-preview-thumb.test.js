import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import UploadPreviewThumb from '../app/upload/UploadPreviewThumb.jsx';

describe('UploadPreviewThumb', () => {
    it('renders a visible remove action when a file is selected', () => {
        const markup = renderToStaticMarkup(
            React.createElement(UploadPreviewThumb, {
                fileName: 'recipe.jpg',
                previewUrl: 'blob:preview',
                disablePreview: false,
                isPreparingPreview: false,
                onRemoveImage: vi.fn()
            })
        );

        expect(markup).toContain('aria-label="Remove image"');
        expect(markup).toContain('>Remove image<');
    });
});
