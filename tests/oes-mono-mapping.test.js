import { describe, expect, it } from 'vitest';

import { makeOESXml } from '../lib/oes.js';

// These cases mirror the ground-truth .oes files exported directly from OM Workspace's
// Monochrome Creator panel (one attribute combination isolated per file), used to reverse
// engineer the MonochroCreater mapping. See openspec/changes/mono-oes-export.
const FILTER_HUE_CASES = [
    ['None', 0],
    ['Yellow Filter', 1],
    ['Orange Filter', 2],
    ['Red Filter', 3],
    ['Magenta Filter', 4],
    ['Blue Filter', 5],
    ['Cyan Filter', 6],
    ['Green Filter', 7],
    ['Yellow-Green Filter', 8]
];

const TONE_CASES = [
    ['Normal', 1],
    ['Sepia', 2],
    ['Blue', 3],
    ['Purple', 4],
    ['Green', 5]
];

const GRAIN_CASES = [
    ['Off', 0],
    ['Low', 1],
    ['Medium', 2],
    ['High', 3]
];

function monochroCreaterAttrs(xml) {
    const m = xml.match(
        /<MonochroCreater Mode="Manual" SatValue="(-?\d+)" HueValue="(-?\d+)" Graininess="(-?\d+)" ColorTone="(-?\d+)" \/>/
    );
    if (!m) throw new Error(`MonochroCreater element not found in:\n${xml}`);
    return { SatValue: m[1], HueValue: m[2], Graininess: m[3], ColorTone: m[4] };
}

function baseMonoSettings(overrides) {
    return {
        type: 'MONO',
        monochromeColor: 'None',
        monochromeColorStrength: null,
        filmHue: 'Normal',
        filmGrain: 'Off',
        contrast: 0,
        sharpness: 0,
        highlights: 0,
        midtones: 0,
        shadows: 0,
        ExposureCompensation: 0,
        ...overrides
    };
}

describe('makeOESXml (monochrome)', () => {
    it('always emits RawEditMode, FinishingMode, ColorCreater Off, and MonochroCreater', () => {
        const xml = makeOESXml(baseMonoSettings());
        expect(xml).toContain('<RawEditMode Apply="true" Mode="2" />');
        expect(xml).toContain('<FinishingMode Apply="true" Mode="Natural" />');
        expect(xml).toContain('<ColorCreater Mode="Off" />');
        expect(xml).not.toContain('ColorCreater2');
    });

    it.each(FILTER_HUE_CASES)('maps filter color %s to HueValue %i', (monochromeColor, hueValue) => {
        const xml = makeOESXml(baseMonoSettings({ monochromeColor, monochromeColorStrength: hueValue === 0 ? null : 1 }));
        const attrs = monochroCreaterAttrs(xml);
        expect(attrs.HueValue).toBe(String(hueValue));
        expect(attrs.SatValue).toBe(hueValue === 0 ? '0' : '1');
    });

    it.each(TONE_CASES)('maps film hue %s to ColorTone %i', (filmHue, colorTone) => {
        const xml = makeOESXml(baseMonoSettings({ filmHue }));
        expect(monochroCreaterAttrs(xml).ColorTone).toBe(String(colorTone));
    });

    it.each(GRAIN_CASES)('maps film grain %s to Graininess %i', (filmGrain, graininess) => {
        const xml = makeOESXml(baseMonoSettings({ filmGrain }));
        expect(monochroCreaterAttrs(xml).Graininess).toBe(String(graininess));
    });

    it('clamps filter strength to 0-3 and ignores it when no filter is active', () => {
        const activeXml = makeOESXml(baseMonoSettings({ monochromeColor: 'Yellow Filter', monochromeColorStrength: 9 }));
        expect(monochroCreaterAttrs(activeXml).SatValue).toBe('3');

        const inactiveXml = makeOESXml(baseMonoSettings({ monochromeColor: 'None', monochromeColorStrength: 3 }));
        expect(monochroCreaterAttrs(inactiveXml).SatValue).toBe('0');
    });

    it('defaults to no filter, normal tone, and no grain when fields are missing', () => {
        const xml = makeOESXml({ type: 'MONO' });
        expect(monochroCreaterAttrs(xml)).toEqual({ SatValue: '0', HueValue: '0', Graininess: '0', ColorTone: '1' });
    });

    it('reuses the shared tone-curve, white balance, contrast, and sharpness elements', () => {
        const xml = makeOESXml(
            baseMonoSettings({
                contrast: -2,
                sharpness: 1,
                highlights: 3,
                midtones: -1,
                shadows: 2,
                whiteBalanceAmberOffset: 1,
                whiteBalanceGreenOffset: -1,
                ExposureCompensation: '0.3'
            })
        );
        expect(xml).toContain('<ExposureBias Apply="true" Numerator="3" Denominator="10" />');
        expect(xml).toContain('<WhiteBalance Apply="true" Mode="Preset" Kelvin="0" RedAdjust="1" GreenAdjust="-1" Type="4096" />');
        expect(xml).toContain('<Contrast Apply="true" Mode="Manual" Value="-2" Adjust="0" />');
        expect(xml).toContain('<Sharpness Apply="true" Mode="Manual" Value="1" Adjust="0" />');
        expect(xml).toContain('<ToneControl Apply="true" Mode="Manual" Bright="3" Dark="2" Mid="-1" />');
    });
});
