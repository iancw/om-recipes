import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RecipeSettings from '../components/RecipeSettings.jsx';

describe('RecipeSettings', () => {
    it('renders monochrome-specific controls without the saturation wheel', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSettings, {
                recipe: {
                    type: 'MONO',
                    monochromeProfile: 'Monochrome Profile 2',
                    monochromeColor: 'Red Filter',
                    monochromeColorStrength: 3,
                    filmGrain: 'Strong',
                    filmHue: 'Warm',
                    monochromeVignetting: 'High',
                    whiteBalance2: 'Custom WB 1',
                    whiteBalanceTemperature: 5200,
                    whiteBalanceAmberOffset: 1,
                    whiteBalanceGreenOffset: -1,
                    shadows: 0,
                    midtones: 1,
                    highlights: -1,
                    sharpness: 0,
                    contrast: 1,
                    exposureCompensation: 0,
                    shadingEffect: 0
                }
            })
        );

        expect(markup).toContain('data-settings-panel="mono"');
        expect(markup).not.toContain('data-settings-saturation-wheel');
        expect(markup).toContain('data-mono-filter-display="true"');
        expect(markup).toContain('data-filter-color="Red"');
        expect(markup).toContain('data-filter-level="3"');
        expect(markup).toContain('>Red<');
        expect(markup).toContain('>Level 3<');
        expect(markup).toContain('data-mono-filter-graphic="true"');
        expect(markup).toContain('data-filter-ring-offset="-20"');
        expect(markup).toContain('data-filter-level-cross="true"');
        expect(markup).toContain('stroke-width="3"');
        expect(markup).not.toContain('conic-gradient(');
        expect(markup).toContain('Film Grain');
        expect(markup).toContain('Film Hue');
        expect(markup).toContain('Shading Effect: 0');
        expect(markup).not.toContain('Profile');
        expect(markup).not.toContain('Monochrome Vignetting');
        expect(markup).not.toContain('Red Filter');
        expect(markup).not.toContain('Color Filter');
        expect(markup).not.toContain('Filter Amount');
    });

    it('renders the none state with a level 0 monochrome filter graphic', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSettings, {
                recipe: {
                    type: 'MONO',
                    monochromeColor: 'None',
                    monochromeColorStrength: 3,
                    filmGrain: 'Low',
                    filmHue: 'Neutral',
                    shadows: 0,
                    midtones: 0,
                    highlights: 0,
                    sharpness: 0,
                    contrast: 0,
                    exposureCompensation: 0,
                    shadingEffect: 2
                }
            })
        );

        expect(markup).toContain('data-mono-filter-display="true"');
        expect(markup).toContain('data-filter-color="None"');
        expect(markup).toContain('data-filter-level="0"');
        expect(markup).toContain('>None<');
        expect(markup).toContain('>Level 0<');
        expect(markup).toContain('Shading Effect: 2');
    });

    it('normalizes no-filter variants to None', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSettings, {
                recipe: {
                    type: 'MONO',
                    monochromeColor: 'No Filter',
                    monochromeColorStrength: 2,
                    filmGrain: 'Low',
                    filmHue: 'Neutral',
                    shadows: 0,
                    midtones: 0,
                    highlights: 0,
                    sharpness: 0,
                    contrast: 0,
                    exposureCompensation: 0,
                    shadingEffect: 0
                }
            })
        );

        expect(markup).toContain('data-filter-color="None"');
        expect(markup).toContain('data-filter-level="0"');
        expect(markup).toContain('>None<');
        expect(markup).not.toContain('>No<');
    });

    it('keeps the saturation wheel for color recipes', () => {
        const markup = renderToStaticMarkup(
            React.createElement(RecipeSettings, {
                recipe: {
                    type: 'COLOR',
                    yellow: 1,
                    orange: 0,
                    orangeRed: 0,
                    red: -1,
                    magenta: 0,
                    violet: 0,
                    blue: 0,
                    blueCyan: 0,
                    cyan: 0,
                    greenCyan: 0,
                    green: 0,
                    yellowGreen: 2,
                    shadows: 0,
                    midtones: 1,
                    highlights: -1,
                    sharpness: 0,
                    contrast: 1,
                    exposureCompensation: 0,
                    shadingEffect: 0
                }
            })
        );

        expect(markup).toContain('data-settings-panel="color"');
        expect(markup).toContain('data-settings-saturation-wheel');
    });
});
