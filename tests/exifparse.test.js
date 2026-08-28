import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseRecipeSettingsFromExif, parseCameraMetadataFromExif } from '../lib/exifparse.js';

// Minimal valid exif string — just enough context for each test to be self-contained.
// Fields use the spacing exiftool actually produces.

const BASE_EXIF = `
Color Profile Settings          : Min -5; Max 5; Yellow 0; Orange 0; Orange-Red 0; Red 0; Magenta 0; Violet 0; Blue 0; Blue-Cyan 0; Cyan 0; Green-Cyan 0; Green 0; Yellow-Green 0
Tone Level                      : Highlights; 0; Shadows; 0; Midtones; 0
Sharpness Setting               : 0
Contrast Setting                : 0
White Balance 2                 : Auto WB (Keep Warm Color Off)
White Balance Bracket           : 0 0
`;

// Overrides are prepended so they match first (parser uses first regex match).
function makeExif(overrides = '') {
    return overrides + '\n' + BASE_EXIF;
}

function loadExifFixture(name) {
    return readFileSync(new URL(`../openspec/changes/monochrome-profiles/sample-exif/${name}`, import.meta.url), 'utf8');
}

describe('parseRecipeSettingsFromExif', () => {
    describe('recipe type', () => {
        it('classifies recipes without monochrome maker notes as COLOR', () => {
            const exif = makeExif(`
Picture Mode                    : Color Profile 2; 2
Monochrome Color                : (none)
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.recipeType).toBe('COLOR');
            expect(result.hasMonochromeProfileSettings).toBe(false);
            expect(result.monochromeProfile).toBeNull();
            expect(result.monochromeColor).toBeNull();
            expect(result.monochromeColorStrength).toBeNull();
            expect(result.filmGrain).toBeNull();
            expect(result.filmHue).toBeNull();
            expect(result.monochromeVignetting).toBeNull();
        });

        it('treats sentinel monochrome profile settings values as absent', () => {
            for (const sentinel of ['(none)', 'n/a']) {
                const exif = makeExif(`
Picture Mode                    : Color Profile 2; 2
Monochrome Profile Settings     : ${sentinel}
Monochrome Color                : (none)
`);
                const result = parseRecipeSettingsFromExif(exif);
                expect(result.recipeType).toBe('COLOR');
                expect(result.hasMonochromeProfileSettings).toBe(false);
                expect(result.monochromeProfile).toBeNull();
                expect(result.monochromeColor).toBeNull();
                expect(result.monochromeColorStrength).toBeNull();
                expect(result.filmGrain).toBeNull();
                expect(result.filmHue).toBeNull();
                expect(result.monochromeVignetting).toBeNull();
            }
        });

        it('classifies monochrome maker notes as MONO and parses shared controls from fixture EXIF', () => {
            const result = parseRecipeSettingsFromExif(loadExifFixture('P4070386.JPG.txt'));
            expect(result.recipeType).toBe('MONO');
            expect(result.hasMonochromeProfileSettings).toBe(true);
            expect(result.hasColorProfileSettings).toBe(true);
            expect(result.monochromeProfile).toBe('Monochrome Profile 2');
            expect(result.monochromeColor).toBe('Red Filter');
            expect(result.monochromeColorStrength).toBe(3);
            expect(result.filmGrain).toBe('Off');
            expect(result.filmHue).toBe('Normal');
            expect(result.monochromeVignetting).toBe('0');
            expect(result.Vignette).toBe('0');
            expect(result.whiteBalance2).toBe('Auto');
            expect(result.whiteBalanceTemperature).toBeNull();
            expect(result.whiteBalanceAmberOffset).toBe(0);
            expect(result.whiteBalanceGreenOffset).toBe(0);
            expect(result.highlights).toBe(6);
            expect(result.shadows).toBe(-6);
            expect(result.midtones).toBe(0);
            expect(result.contrast).toBe(0);
            expect(result.sharpness).toBe(0);
        });

        it('parses alternate monochrome filter, grain, and hue values from fixture EXIF', () => {
            const result = parseRecipeSettingsFromExif(loadExifFixture('P4070391.JPG.txt'));
            expect(result.recipeType).toBe('MONO');
            expect(result.monochromeProfile).toBe('Monochrome Profile 2');
            expect(result.monochromeColor).toBe('Blue Filter');
            expect(result.monochromeColorStrength).toBe(1);
            expect(result.filmGrain).toBe('Medium');
            expect(result.filmHue).toBe('Purple');
            expect(result.monochromeVignetting).toBe('0');
        });
    });

    describe('white balance temperature', () => {
        it('reads temperature from the dedicated White Balance Temperature field', () => {
            const exif = makeExif(`
White Balance 2                 : Custom WB 1
White Balance Temperature       : 5800
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Custom WB 1');
            expect(result.whiteBalanceTemperature).toBe(5800);
        });
        it('reads temperature from the dedicated White Balance Temperature field regardless of custom wb setting', () => {
            const exif = makeExif(`
White Balance 2                 : Custom WB 2
White Balance Temperature       : 4500
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Custom WB 2');
            expect(result.whiteBalanceTemperature).toBe(4500);
        });

        it('reads temperature from the dedicated White Balance Temperature for any white balance 2 value', () => {
            const exif = makeExif(`
White Balance 2                 : Unkown wb field
White Balance Temperature       : 3200
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Unkown wb field');
            expect(result.whiteBalanceTemperature).toBe(3200);
        });

        it('parses Custom WB 1 with temperature 5800 from real exif sample', () => {
            const exif = `
White Balance 2                 : Custom WB 1
White Balance Temperature       : 5800
White Balance Bracket           : 2 1
Raw Dev White Balance Value     : 0
White Balance                   : Manual
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Custom WB 1');
            expect(result.whiteBalanceTemperature).toBe(5800);
            expect(result.whiteBalanceAmberOffset).toBe(2);
            expect(result.whiteBalanceGreenOffset).toBe(1);
        });

        it('parses 7500K (Fine Weather with Shade) with temperature and zero offsets from real exif sample', () => {
            const exif = `
White Balance 2                 : 7500K (Fine Weather with Shade)
White Balance Temperature       : 7500
White Balance Bracket           : 0 0
Raw Dev White Balance Value     : 0
White Balance                   : Manual
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('7500K (Fine Weather with Shade)');
            expect(result.whiteBalanceTemperature).toBe(7500);
            expect(result.whiteBalanceAmberOffset).toBe(0);
            expect(result.whiteBalanceGreenOffset).toBe(0);
        });

        it('parses 5300K (Fine Weather) with temperature and offsets from real exif sample', () => {
            const exif = `
White Balance 2                 : 5300K (Fine Weather)
White Balance Temperature       : 5300
White Balance Bracket           : 7 -5
Raw Dev White Balance Value     : 0
White Balance                   : Manual
Whites 2012                     : 0
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('5300K (Fine Weather)');
            expect(result.whiteBalanceTemperature).toBe(5300);
            expect(result.whiteBalanceAmberOffset).toBe(7);
            expect(result.whiteBalanceGreenOffset).toBe(-5);
        });

        it('parses Custom WB 1 with temperature 5200 from real exif sample', () => {
            const exif = `
White Balance 2                 : Custom WB 1
White Balance Temperature       : 5200
White Balance Bracket           : 1 -1
Raw Dev White Balance Value     : 0
White Balance                   : Manual
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Custom WB 1');
            expect(result.whiteBalanceTemperature).toBe(5200);
            expect(result.whiteBalanceAmberOffset).toBe(1);
            expect(result.whiteBalanceGreenOffset).toBe(-1);
        });

        it('extracts temperature from K-value embedded in White Balance 2', () => {
            const exif = makeExif(`
White Balance 2                 : 5300K (Fine Weather)
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('5300K (Fine Weather)');
            expect(result.whiteBalanceTemperature).toBe(5300);
        });

        it('prefers the K-value in White Balance 2 over a separate temperature field', () => {
            const exif = makeExif(`
White Balance 2                 : 5300K (Fine Weather)
White Balance Temperature       : 5800
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('5300K (Fine Weather)');
            expect(result.whiteBalanceTemperature).toBe(5300);
        });

        it('parses Auto (Keep Warm Color Off) white balance from real exif sample', () => {
            const exif = `
White Balance 2                 : Auto (Keep Warm Color Off)
White Balance Temperature       : Auto
White Balance Bracket           : 2 -1
Raw Dev White Balance Value     : 0
White Balance                   : Manual
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Auto (Keep Warm Color Off)');
            expect(result.whiteBalanceTemperature).toBeNull();
            expect(result.whiteBalanceAmberOffset).toBe(2);
            expect(result.whiteBalanceGreenOffset).toBe(-1);
        });

        it('parses Auto white balance with non-numeric temperature from real exif sample', () => {
            const exif = `
White Balance 2                 : Auto
White Balance Temperature       : Auto
White Balance Bracket           : 4 2
Raw Dev White Balance Value     : 0
White Balance                   : Manual
`;
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalance2).toBe('Auto');
            expect(result.whiteBalanceTemperature).toBeNull();
            expect(result.whiteBalanceAmberOffset).toBe(4);
            expect(result.whiteBalanceGreenOffset).toBe(2);
        });

        it('leaves temperature null when White Balance 2 is a label with no K-value and no temperature field', () => {
            const exif = makeExif(`
White Balance 2                 : Auto WB (Keep Warm Color Off)
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalanceTemperature).toBeNull();
        });

        it('leaves temperature null when the temperature field is absent', () => {
            const exif = makeExif(`
White Balance 2                 : Custom WB 1
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalanceTemperature).toBeNull();
        });
    });

    describe('white balance offsets', () => {
        it('parses amber and green offsets from White Balance Bracket', () => {
            const exif = makeExif(`White Balance Bracket           : 2 1`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalanceAmberOffset).toBe(2);
            expect(result.whiteBalanceGreenOffset).toBe(1);
        });

        it('parses negative offsets', () => {
            const exif = makeExif(`White Balance Bracket           : -3 -1`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.whiteBalanceAmberOffset).toBe(-3);
            expect(result.whiteBalanceGreenOffset).toBe(-1);
        });

        it('leaves offsets null when field is absent', () => {
            const result = parseRecipeSettingsFromExif(`
Color Profile Settings          : Min -5; Max 5; Yellow 0
Tone Level                      : Highlights; 0; Shadows; 0; Midtones; 0
`);
            expect(result.whiteBalanceAmberOffset).toBeNull();
            expect(result.whiteBalanceGreenOffset).toBeNull();
        });
    });

    describe('color profile', () => {
        it('parses all color channels', () => {
            const exif = makeExif(`
Picture Mode                    : Color Profile 2; 2
Art Filter Effect               : Off; 0; 0; Partial Color 0; No Effect; 0; No Color Filter; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0
Color Creator Effect            : Color 0; 0; 29; Strength 0; -4; 3
Color Profile Settings          : Min -5; Max 5; Yellow 5; Orange 4; Orange-red 3; Red 1; Magenta 1; Violet 1; Blue 1; Blue-cyan 1; Cyan 1; Green-cyan 3; Green 4; Yellow-green 5
Monochrome Color                : (none)
Raw Dev Memory Color Emphasis   : 0
Raw Dev Color Space             : sRGB
Color Matrix                    : 386 -104 -26 -32 344 -56 4 -48 300
Color Space                     : sRGB
Color Components                : 3
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.yellow).toBe(5);
            expect(result.orange).toBe(4);
            expect(result.orangeRed).toBe(3);
            expect(result.red).toBe(1);
            expect(result.magenta).toBe(1);
            expect(result.violet).toBe(1);
            expect(result.blue).toBe(1);
            expect(result.blueCyan).toBe(1);
            expect(result.cyan).toBe(1);
            expect(result.greenCyan).toBe(3);
            expect(result.green).toBe(4);
            expect(result.yellowGreen).toBe(5);
        });

        it('sets hasColorProfileSettings true when present', () => {
            const result = parseRecipeSettingsFromExif(BASE_EXIF);
            expect(result.hasColorProfileSettings).toBe(true);
        });

        it('sets hasColorProfileSettings false when absent', () => {
            const result = parseRecipeSettingsFromExif(`
Tone Level                      : Highlights; 0; Shadows; 0; Midtones; 0
White Balance 2                 : Auto WB (Keep Warm Color Off)
`);
            expect(result.hasColorProfileSettings).toBe(false);
        });
    });

    describe('tone level', () => {
        it('parses highlights, midtones, and shadows', () => {
            const exif = makeExif(`
Tone Level                      : Highlights; 3; Shadows; -3; Midtones; 1
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.highlights).toBe(3);
            expect(result.shadows).toBe(-3);
            expect(result.midtones).toBe(1);
        });

        it('sets hasToneLevel true when present', () => {
            const result = parseRecipeSettingsFromExif(BASE_EXIF);
            expect(result.hasToneLevel).toBe(true);
        });
    });

    describe('shading effect', () => {
        it('parses a positive shading effect for a color recipe', () => {
            const exif = makeExif(`
Picture Mode                    : Color Profile 1; 2
Monochrome Vignetting           : 3
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.recipeType).toBe('COLOR');
            expect(result.shadingEffect).toBe(3);
        });

        it('parses a negative shading effect for a color recipe', () => {
            const exif = makeExif(`
Picture Mode                    : Color Profile 1; 2
Monochrome Vignetting           : -5
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.shadingEffect).toBe(-5);
        });

        it('parses the shading effect for a monochrome recipe', () => {
            const exif = makeExif(`
Picture Mode                    : Monochrome Profile 2; 2
Monochrome Profile Settings     : Red Filter; 0; 8; Strength 3; 0; 3
Monochrome Vignetting           : 2
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.recipeType).toBe('MONO');
            expect(result.shadingEffect).toBe(2);
        });

        it('leaves shading effect null when the tag is absent', () => {
            const result = parseRecipeSettingsFromExif(makeExif(`Picture Mode                    : Color Profile 1; 2`));
            expect(result.shadingEffect).toBeNull();
        });
    });

    describe('exposure compensation', () => {
        it('parses fractional-stop exposure compensation into tenths', () => {
            const result = parseRecipeSettingsFromExif(makeExif(`Exposure Compensation           : -0.3`));
            expect(result.exposureCompensation).toBe(-3);
        });

        it('parses a positive whole-stop exposure compensation into tenths', () => {
            const result = parseRecipeSettingsFromExif(makeExif(`Exposure Compensation           : +1.0`));
            expect(result.exposureCompensation).toBe(10);
        });

        it('leaves exposure compensation null when the tag is absent', () => {
            const result = parseRecipeSettingsFromExif(`
Color Profile Settings          : Min -5; Max 5; Yellow 0
Tone Level                      : Highlights; 0; Shadows; 0; Midtones; 0
`);
            expect(result.exposureCompensation).toBeNull();
        });
    });

    describe('sharpness and contrast', () => {
        it('parses sharpness and contrast settings', () => {
            const exif = makeExif(`
Sharpness Setting               : 3
Contrast Setting                : -1
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.sharpness).toBe(3);
            expect(result.contrast).toBe(-1);
        });
    });

    describe('OM Workspace detection', () => {
        it('flags isOmWorkspace when Software contains "OM Workspace"', () => {
            const exif = makeExif(`Software                        : OM Workspace 1.7.0`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.isOmWorkspace).toBe(true);
        });

        it('flags isOmWorkspace for OM Workspace 2.4M and preserves source metadata', () => {
            const exif = makeExif(`
Camera Model Name               : OM-3
Software                        : OM Workspace 2.4M
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.cameraModelName).toBe('OM-3');
            expect(result.software).toBe('OM Workspace 2.4M');
            expect(result.source).toBe('OM-3/OM Workspace 2.4M');
            expect(result.isOmWorkspace).toBe(true);
        });

        it('builds recipe source from Camera Model Name and Software', () => {
            const exif = makeExif(`
Camera Model Name               : OM-3
Software                        : Version 1.1
`);
            const result = parseRecipeSettingsFromExif(exif);
            expect(result.cameraModelName).toBe('OM-3');
            expect(result.software).toBe('Version 1.1');
            expect(result.source).toBe('OM-3/Version 1.1');
            expect(result.isOmWorkspace).toBe(false);
        });
    });
});

describe('parseCameraMetadataFromExif', () => {
    it('parses camera, lens, and exposure fields from full fixture EXIF', () => {
        const result = parseCameraMetadataFromExif(loadExifFixture('P4070386.JPG.txt'));
        expect(result.camera).toBe('OM-3');
        expect(result.lens).toBe('OLYMPUS M.17mm F1.8');
        expect(result.shutterSpeed).toBe('1/800');
        expect(result.aperture).toBe('8.0');
        expect(result.focalLength).toBe('17.0 mm');
        expect(result.iso).toBe('320');
    });

    it('leaves fields null when their tags are absent, independent of other present fields', () => {
        const exif = `
Camera Model Name               : OM-1 Mark II
ISO                              : 200
`;
        const result = parseCameraMetadataFromExif(exif);
        expect(result.camera).toBe('OM-1 Mark II');
        expect(result.iso).toBe('200');
        expect(result.lens).toBeNull();
        expect(result.shutterSpeed).toBeNull();
        expect(result.aperture).toBeNull();
        expect(result.focalLength).toBeNull();
    });

    it('returns all nulls when no relevant tags are present', () => {
        const result = parseCameraMetadataFromExif(BASE_EXIF);
        expect(result).toEqual({
            camera: null,
            lens: null,
            shutterSpeed: null,
            aperture: null,
            focalLength: null,
            iso: null
        });
    });

    it('treats a "(none)" lens model sentinel as absent rather than a literal string', () => {
        const exif = `
Camera Model Name               : OM-1 Mark II
Lens Model                      : (none)
`;
        const result = parseCameraMetadataFromExif(exif);
        expect(result.lens).toBeNull();
    });
});
