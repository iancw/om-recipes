import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import RecipeCard from '../components/recipe-card.jsx';

vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        refresh: vi.fn()
    })
}));

vi.mock('next/image', () => ({
    default: ({ unoptimized, priority, fill, ...props }) => React.createElement('img', props)
}));

vi.mock('../components/RecipeSettings.jsx', () => ({
    default: () => null
}));

vi.mock('../components/AuthorSocialLinks.jsx', () => ({
    default: () => null
}));

vi.mock('../components/DeleteConfirmationModal.jsx', () => ({
    default: () => null
}));

vi.mock('../components/ui/badge.jsx', () => ({
    Badge: ({ children }) => React.createElement('span', null, children)
}));

vi.mock('../components/ui/button.jsx', () => ({
    Button: ({ children, ...props }) => React.createElement('button', props, children),
    buttonVariants: () => 'button'
}));

vi.mock('../components/ui/card.jsx', () => ({
    Card: ({ children, ...props }) => React.createElement('div', props, children),
    CardContent: ({ children, ...props }) => React.createElement('div', props, children)
}));

vi.mock('../components/ui/input.jsx', () => ({
    Input: (props) => React.createElement('input', props)
}));

vi.mock('../components/ui/textarea.jsx', () => ({
    Textarea: (props) => React.createElement('textarea', props)
}));

describe('RecipeCard', () => {
    it('renders the recipe sample image label on the preview image', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    authorName: 'Photographer',
                    sampleImages: [
                        {
                            id: 'sample-1',
                            isPrimary: true,
                            smallUrl: '/assets/images/320/sample.jpg'
                        }
                    ]
                }
            })
        );

        expect(markup).toContain('alt="Recipe Sample Image"');
    });
});
