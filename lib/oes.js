// Shared OES generator used by both scripts and server actions.
//
// The output format is based on scripts/generate-oes-files.js for color recipes.
// The monochrome branch is based on reverse-engineered OM Workspace batch
// processing files exported directly from the Monochrome Creator panel
// (see openspec/changes/mono-oes-export for the sample files and mapping notes).

// Define saturation order
const satOrder = [
    'Yellow',
    'Orange',
    'OrangeRed',
    'Red',
    'Magenta',
    'Violet',
    'Blue',
    'BlueCyan',
    'Cyan',
    'CyanGreen',
    'Green',
    'GreenYellow'
];

// Monochrome Creator filter color -> MonochroCreater HueValue.
// Order/values confirmed against sample .oes exports (mono-<color>-<strength>-<tone>-<grain>.oes).
const MONO_FILTER_HUE = {
    none: 0,
    yellow: 1,
    orange: 2,
    red: 3,
    magenta: 4,
    blue: 5,
    cyan: 6,
    green: 7,
    yellowgreen: 8
};

// Monochrome Color (film tone) -> MonochroCreater ColorTone.
const MONO_COLOR_TONE = {
    normal: 1,
    neutral: 1,
    sepia: 2,
    blue: 3,
    purple: 4,
    green: 5
};

// Film Grain Effect -> MonochroCreater Graininess.
const MONO_GRAININESS = {
    off: 0,
    low: 1,
    medium: 2,
    high: 3
};

function getVal(obj, key, fallback = '0') {
    return obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== ''
        ? obj[key]
        : fallback;
}

// Clamp to OM Workspace-ish value ranges.
function clampInt(v, min, max, fallback = 0) {
    const n = Number.parseInt(String(v), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

// "Red Filter" / "No Color Filter" / "" -> "red" / "none" / "none"
function normalizeMonoFilterKey(value) {
    const s = String(value ?? '').trim();
    if (!s) return 'none';
    if (/^(none|no)(\s+color)?(\s+filter)?$/i.test(s)) return 'none';
    return s.replace(/\s+filter$/i, '').toLowerCase().replace(/[\s-]+/g, '');
}

// "Normal" / "Neutral" / "Sepia" -> "normal" / "normal" / "sepia"
function normalizeMonoToneKey(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s || s === 'neutral') return 'normal';
    return s;
}

// "Off" / "Low" -> "off" / "low"
function normalizeMonoGrainKey(value) {
    return String(value ?? '').trim().toLowerCase() || 'off';
}

function getMonoFilterHue(recipeSettings) {
    const key = normalizeMonoFilterKey(recipeSettings?.monochromeColor);
    return MONO_FILTER_HUE[key] ?? 0;
}

function getMonoFilterStrength(recipeSettings, hueValue) {
    // A filter that isn't active never carries a strength, regardless of any stored value.
    if (hueValue === 0) return 0;
    return clampInt(recipeSettings?.monochromeColorStrength, 0, 3, 0);
}

function getMonoColorTone(recipeSettings) {
    const key = normalizeMonoToneKey(recipeSettings?.filmHue);
    return MONO_COLOR_TONE[key] ?? 1;
}

function getMonoGraininess(recipeSettings) {
    const key = normalizeMonoGrainKey(recipeSettings?.filmGrain);
    return MONO_GRAININESS[key] ?? 0;
}

/**
 * @param {object} recipeSettings - recipe settings object from lib/exifparse.js / lib/recipe-data.js
 * @returns {string} OES XML
 */
export function makeOESXml(recipeSettings) {
    const isMono = String(recipeSettings?.type ?? recipeSettings?.recipeType ?? '').toUpperCase() === 'MONO';

    // We do not currently parse KeepWarm or WhiteBalance Kelvin from EXIF into our UI object.
    // For now, keep the behavior compatible with our existing generator script and default
    // to Auto (Keep Warm On).
    const Kelvin = getVal(recipeSettings, 'WhiteBalance', '0');
    const KeepWarm = getVal(recipeSettings, 'KeepWarm', 'on');
    const WBType =
        Kelvin == '0' && KeepWarm == 'on'
            ? '4096'
            : Kelvin == '0' && KeepWarm == 'off'
              ? '4098'
              : '0';

    // Our parsed object uses offsets already; script uses different keys.
    const RedAdjust = clampInt(getVal(recipeSettings, 'whiteBalanceAmberOffset', '0'), -7, 6, 0);
    const GreenAdjust = clampInt(getVal(recipeSettings, 'whiteBalanceGreenOffset', '0'), -7, 6, 0);

    // Parsed EXIF value is typically like "+0.3" or "0"; OES expects tenth-stops.
    const evRaw = Number.parseFloat(String(recipeSettings?.ExposureCompensation ?? 0));
    const EV = Number.isFinite(evRaw) ? Math.round(evRaw * 10) : 0;

    const Bright = getVal(recipeSettings, 'highlights', '0');
    const Mid = getVal(recipeSettings, 'midtones', '0');
    const Dark = getVal(recipeSettings, 'shadows', '0');

    const Contrast = getVal(recipeSettings, 'contrast', '0');
    const Sharpness = getVal(recipeSettings, 'sharpness', '0');

    if (isMono) {
        const HueValue = getMonoFilterHue(recipeSettings);
        const SatValue = getMonoFilterStrength(recipeSettings, HueValue);
        const ColorTone = getMonoColorTone(recipeSettings);
        const Graininess = getMonoGraininess(recipeSettings);

        return `<?xml version="1.0" encoding="UTF-8"?>
<ImageProcessing>
  <ParametersType FormatID="65539" Platform="M" Version="2401" />
  <Parameters>
    <RawEditMode Apply="true" Mode="2" />
    <FinishingMode Apply="true" Mode="Natural" />
    <ExposureBias Apply="true" Numerator="${EV}" Denominator="10" />
    <WhiteBalance Apply="true" Mode="Preset" Kelvin="${Kelvin}" RedAdjust="${RedAdjust}" GreenAdjust="${GreenAdjust}" Type="${WBType}" />
    <Contrast Apply="true" Mode="Manual" Value="${Contrast}" Adjust="0" />
    <Sharpness Apply="true" Mode="Manual" Value="${Sharpness}" Adjust="0" />
    <ToneControl Apply="true" Mode="Manual" Bright="${Bright}" Dark="${Dark}" Mid="${Mid}" />
    <ColorCreater Mode="Off" />
    <MonochroCreater Mode="Manual" SatValue="${SatValue}" HueValue="${HueValue}" Graininess="${Graininess}" ColorTone="${ColorTone}" />
  </Parameters>
</ImageProcessing>
`;
    }

    // Map our camelCase fields to the generator’s sat order.
    const satMap = {
        Yellow: recipeSettings?.yellow,
        Orange: recipeSettings?.orange,
        OrangeRed: recipeSettings?.orangeRed,
        Red: recipeSettings?.red,
        Magenta: recipeSettings?.magenta,
        Violet: recipeSettings?.violet,
        Blue: recipeSettings?.blue,
        BlueCyan: recipeSettings?.blueCyan,
        Cyan: recipeSettings?.cyan,
        CyanGreen: recipeSettings?.greenCyan,
        Green: recipeSettings?.green,
        GreenYellow: recipeSettings?.yellowGreen
    };
    const satVals = satOrder.map((col) => getVal(satMap, col, '0')).join(',');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ImageProcessing>
  <ParametersType FormatID="65539" Platform="M" Version="2401" />
  <Parameters>
    <RawEditMode Apply="true" Mode="2" />
    <ExposureBias Apply="true" Numerator="${EV}" Denominator="10" />
    <WhiteBalance Apply="true" Mode="Preset" Kelvin="${Kelvin}" RedAdjust="${RedAdjust}" GreenAdjust="${GreenAdjust}" Type="${WBType}" />
    <Contrast Apply="true" Mode="Manual" Value="${Contrast}" Adjust="0" />
    <Sharpness Apply="true" Mode="Manual" Value="${Sharpness}" Adjust="0" />
    <ToneControl Apply="true" Mode="Manual" Bright="${Bright}" Dark="${Dark}" Mid="${Mid}" />
    <ColorCreater2 Apply="true" Mode="Manual" SatValue="${satVals}" LumValue="0,0,0,0,0,0,0,0,0,0,0,0" HueValue="0,0,0,0,0,0,0,0,0,0,0,0" />
  </Parameters>
</ImageProcessing>
`;
}
