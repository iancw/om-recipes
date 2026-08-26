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

vi.mock('next/link', () => ({
    default: ({ children, ...props }) => React.createElement('a', props, children)
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

    it('does not render extra sample thumbnails when showSampleStrip is false', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' },
                        { id: 'sample-2', smallUrl: '/assets/images/320/b.jpg' }
                    ]
                }
            })
        );

        expect(markup).not.toContain('Sample image');
    });

    it('does not render extra sample thumbnails when only one sample image exists', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' }
                    ]
                },
                showSampleStrip: true
            })
        );

        expect(markup).not.toContain('Sample image');
    });

    it('renders the primary and additional sample images as thumbnails when showSampleStrip is enabled', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' },
                        { id: 'sample-2', smallUrl: '/assets/images/320/b.jpg', sampleAuthor: { name: 'Jamie' } },
                        { id: 'sample-3', smallUrl: '/assets/images/320/c.jpg' }
                    ]
                },
                showSampleStrip: true
            })
        );

        expect(markup).toContain('Sample by Jamie');
        expect((markup.match(/aria-label="Sample image"/g) ?? []).length).toBe(2);
    });

    it('shows a linked remaining-count tile when more samples exist than fit in the strip', () => {
        const sampleImages = [{ id: 'sample-0', isPrimary: true, smallUrl: '/assets/images/320/0.jpg' }];
        for (let i = 1; i <= 5; i += 1) {
            sampleImages.push({ id: `sample-${i}`, smallUrl: `/assets/images/320/${i}.jpg` });
        }

        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: { id: 42, recipeName: 'Portra 400', slug: 'portra-400', sampleImages },
                showSampleStrip: true
            })
        );

        expect(markup).toContain('href="/recipes/portra-400"');
        expect(markup).toContain('+3');
    });

    it('ignores hidden sample images when building the thumbnail strip', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' },
                        { id: 'sample-hidden', copyright: false, smallUrl: '/assets/images/320/b.jpg' }
                    ]
                },
                showSampleStrip: true
            })
        );

        expect(markup).not.toContain('Sample image');
    });

    it('does not render the sample strip for non-sample image selections', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' },
                        { id: 'sample-2', smallUrl: '/assets/images/320/b.jpg' }
                    ],
                    comparisonImages: [
                        { id: 'comparison-1', label: 'lighthouse', smallUrl: '/assets/images/320/c.jpg' }
                    ]
                },
                showSampleStrip: true,
                selectedImageOption: 'comparison:lighthouse'
            })
        );

        expect(markup).not.toContain('Sample image');
    });

    it('fills out the strip with comparison images, after the samples, when a recipe is short on samples', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeCard, {
                recipe: {
                    id: 42,
                    recipeName: 'Portra 400',
                    sampleImages: [
                        { id: 'sample-1', isPrimary: true, smallUrl: '/assets/images/320/a.jpg' }
                    ],
                    comparisonImages: [
                        { id: 'comparison-1', label: 'lighthouse', smallUrl: '/assets/images/320/b.jpg' },
                        { id: 'comparison-2', label: 'city', smallUrl: '/assets/images/320/c.jpg' }
                    ]
                },
                showSampleStrip: true
            })
        );

        const sampleLabelIndex = markup.indexOf('aria-label="Sample image"');
        const comparisonLabelIndex = markup.indexOf('aria-label="Comparison: Lighthouse"');
        expect(sampleLabelIndex).toBeGreaterThan(-1);
        expect(comparisonLabelIndex).toBeGreaterThan(-1);
        expect(sampleLabelIndex).toBeLessThan(comparisonLabelIndex);
        expect(markup).toContain('aria-label="Comparison: City"');
    });
});
