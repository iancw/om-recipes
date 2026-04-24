
export const RECIPE_EXIFTOOL_ARGS = [
    '-CameraModelName',
    '-Software',
    '-WhiteBalance2',
    '-WhiteBalanceTemperature',
    '-WhiteBalanceBracket',
    '-ColorProfileSettings',
    '-ToneLevel',
    '-SharpnessSetting',
    '-ContrastSetting',
    '-MonochromeVignetting',
    '-ExposureCompensation',
];

/**
 * Parse recipe settings from exiftool output.
 * @param {string} exifStr - exiftool output as a string
 * @returns {object} Parsed recipe settings object (matches current DB schema + UI expectations)
 */
export function parseRecipeSettingsFromExif(exifStr) {
    // Helper to get value by regex, group 1 is desired value.
    const getValue = (regex, src = exifStr) => {
        const m = src.match(regex);
        return m ? m[1].trim() : '';
    };

    const isBlank = (v) => v == null || String(v).trim() === '';

    const toIntOrNull = (v) => {
        if (isBlank(v)) return null;
        const n = Number.parseInt(String(v), 10);
        return Number.isFinite(n) ? n : null;
    };

    const toSmallIntOrNull = (v) => {
        const n = toIntOrNull(v);
        if (n == null) return null;
        if (n < -32768 || n > 32767) return null;
        return n;
    };

    // --- White balance
    // In the DB schema, white_balance_2 is a label (e.g. "Custom WB 1" or "Auto ...")
    // and white_balance_temperature is an integer temperature when applicable.
    const rawWb2 = getValue(/White Balance 2\s+:([^\n]+)/);
    let whiteBalance2 = rawWb2 || null;
    let whiteBalanceTemperature = null;

    // exiftool often returns strings like: "5300K (Fine Weather)".
    // Mirror scripts/import-om-recipes-to-db.mjs behavior: if it looks numeric,
    // treat it as a custom WB with temperature.
    const wbTempMatch = String(rawWb2 || '').match(/^(\d{3,5})\s*K\b/i) ||
        String(rawWb2 || '').match(/\b(\d{3,5})\s*K\b/i);
    if (wbTempMatch) {
        whiteBalanceTemperature = toIntOrNull(wbTempMatch[1]);
    }

    // Also check the dedicated White Balance Temperature field (e.g. when
    // White Balance 2 is "Custom WB 1" and temperature is a separate tag).
    if (whiteBalanceTemperature == null) {
        const rawWbTemp = getValue(/White Balance Temperature\s+:([^\n]+)/);
        whiteBalanceTemperature = toIntOrNull(rawWbTemp);
    }

    // WhiteBalanceAmberShift, WhiteBalanceGreenShift
    // Example: Raw Dev WB Fine Adjustment      : 3 1
    const wbFineMatch = exifStr.match(/White Balance Bracket\s+:([-\d ]+)/);
    let whiteBalanceAmberOffset = null;
    let whiteBalanceGreenOffset = null;
    if (wbFineMatch) {
        const wbs = wbFineMatch[1].trim().split(/\s+/);
        whiteBalanceAmberOffset = toSmallIntOrNull(wbs[0]);
        whiteBalanceGreenOffset = toSmallIntOrNull(wbs[1]);
    }

    // Color Profile Settings parsing:
    // eg: Color Profile Settings    : Min -5; Max 5; Yellow 1; Orange 1; ...
    const colorProfile = getValue(/Color Profile Settings\s+:(.*)/);
    // We'll extract by mapping name substrings to fields
    let yellow = null,
        orange = null,
        orangeRed = null,
        red = null,
        magenta = null,
        violet = null,
        blue = null,
        blueCyan = null,
        cyan = null,
        greenCyan = null,
        green = null,
        yellowGreen = null;
    if (colorProfile) {
        const colorMap = {};
        colorProfile.split(';').map(v => v.trim()).forEach(chunk => {
            const m = chunk.match(/^([A-Za-z\- ]+)\s+(-?\d+)/);
            if (m) colorMap[m[1].trim().replace(/[- ]/g, '')] = m[2];
        });
        yellow = toSmallIntOrNull(colorMap['Yellow']);
        orange = toSmallIntOrNull(colorMap['Orange']);
        orangeRed = toSmallIntOrNull(colorMap['Orangered']);
        red = toSmallIntOrNull(colorMap['Red']);
        magenta = toSmallIntOrNull(colorMap['Magenta']);
        violet = toSmallIntOrNull(colorMap['Violet']);
        blue = toSmallIntOrNull(colorMap['Blue']);
        blueCyan = toSmallIntOrNull(colorMap['Bluecyan']);
        cyan = toSmallIntOrNull(colorMap['Cyan']);
        // NOTE: exiftool labels this "Green Cyan" but our DB schema calls it greenCyan.
        greenCyan = toSmallIntOrNull(colorMap['Greencyan']);
        green = toSmallIntOrNull(colorMap['Green']);
        // NOTE: exiftool labels this "Yellow Green" but our DB schema calls it yellowGreen.
        yellowGreen = toSmallIntOrNull(colorMap['Yellowgreen']);
    }

    // Tone Level parsing (for Shadows, Mids, Highlights):
    // Tone Level                    : Highlights; 3; ... Shadows; -3; ... Midtones; 0; ...
    const toneLevel = getValue(/Tone Level\s+:(.*)/);
    let shadows = null, midtones = null, highlights = null;
    if (toneLevel) {
        const getToneVal = (label) => {
            const m = toneLevel.match(new RegExp(label + ';\\s*(-?\\d+)'));
            return m ? m[1] : '';
        };
        highlights = toSmallIntOrNull(getToneVal('Highlights'));
        midtones = toSmallIntOrNull(getToneVal('Midtones'));
        shadows = toSmallIntOrNull(getToneVal('Shadows'));
    }

    // Vignette
    // Not currently stored in DB schema, but used by the upload preview UI.
    // Keep legacy key name so existing components keep working.
    const Vignette = getValue(/Monochrome Vignetting\s+:([^\n]+)/);

    // Sharpness & Contrast: Try "Sharpness Setting" and "Contrast Setting"
    const sharpness = toSmallIntOrNull(getValue(/Sharpness Setting\s+:\s*(-?\d+)/));
    const contrast = toSmallIntOrNull(getValue(/Contrast Setting\s+:\s*(-?\d+)/));

    // Exposure Compensation
    // Not currently stored in DB schema, but used by the upload preview UI.
    const ExposureCompensation = getValue(/Exposure Compensation\s+:\s*([^\n]+)/);

    const cameraModelName = getValue(/^Camera Model Name\s+:([^\n]+)/m) || null;

    // Software tag — used to detect OM Workspace exports for upload warnings
    const software = getValue(/^Software\s+:([^\n]+)/m) || null;
    const source = [cameraModelName, software].filter((value) => !isBlank(value)).join('/') || null;

    // Assemble the object
    return {
        // --- maker notes presence (used for upload validation)
        hasColorProfileSettings: !isBlank(colorProfile),
        hasToneLevel: !isBlank(toneLevel),
        isOmWorkspace: typeof software === 'string' && software.toLowerCase().includes('om workspace'),

        // --- fields matching db/schema.ts `recipes` table
        yellow,
        orange,
        orangeRed,
        red,
        magenta,
        violet,
        blue,
        blueCyan,
        cyan,
        greenCyan,
        green,
        yellowGreen,
        contrast,
        sharpness,
        highlights,
        shadows,
        midtones,
        whiteBalance2,
        whiteBalanceTemperature,
        whiteBalanceAmberOffset,
        whiteBalanceGreenOffset,
        source,
        cameraModelName,
        software,

        // --- legacy/UI-only fields (not in current DB schema)
        Vignette,
        ExposureCompensation,
    };
}
