
// The upload flow feeds exiftool only the leading bytes of a JPEG (see
// headSliceForExif). Everything read here — Olympus recipe maker notes,
// standard camera/lens EXIF, the embedded IFD1 thumbnail, Orientation — lives
// in the APP1 block near the start of the file, so a head slice yields
// byte-identical results while capping the exiftool WASM instance's linear
// memory regardless of the original file size. That memory (which only grows
// and is not reclaimed before iOS's memory reaper fires) is what reloads the
// upload page on mobile Safari.
export const EXIF_HEAD_SLICE_BYTES = 1_572_864; // 1.5 MB

/**
 * Return a File containing only the first `bytes` of `file` (name and type
 * preserved), or the original when it is already smaller or cannot be sliced.
 */
export function headSliceForExif(file, bytes = EXIF_HEAD_SLICE_BYTES) {
    if (!file || typeof file.slice !== 'function' || !(file.size > bytes)) {
        return file;
    }
    return new File([file.slice(0, bytes)], file.name, { type: file.type });
}

/**
 * True when parsed recipe settings actually contain an OM/Olympus colour or
 * monochrome profile — i.e. exiftool found the recipe maker notes.
 */
export function hasDetectedRecipe(settings) {
    return Boolean(settings?.hasColorProfileSettings || settings?.hasMonochromeProfileSettings);
}

export const RECIPE_EXIFTOOL_ARGS = [
    // Stop exiftool from seeking to the end of the file for trailer data — the
    // Olympus recipe maker notes are in APP1 at the front. `-fast` keeps them;
    // `-fast2` would also skip maker-note processing and lose them.
    '-fast',
    // exiftool's tag database has no tag literally named "CameraModelName" —
    // that string is only the human-readable *output label* for the "Model"
    // tag. Requesting -CameraModelName is silently ignored (exiftool omits
    // unrecognized -TagName args from its output instead of erroring), so
    // the camera model was never actually returned. -Model is the correct
    // arg; its output is still labeled "Camera Model Name", which is why
    // the parsing regexes below didn't need to change.
    '-Model',
    '-LensModel',
    '-ShutterSpeed',
    '-Aperture',
    '-FocalLength',
    '-ISO',
    '-Software',
    '-PictureMode',
    '-WhiteBalance2',
    '-WhiteBalanceTemperature',
    '-WhiteBalanceBracket',
    '-ColorProfileSettings',
    '-MonochromeProfileSettings',
    '-FilmGrainEffect',
    '-MonochromeColor',
    '-ToneLevel',
    '-SharpnessSetting',
    '-ContrastSetting',
    '-MonochromeVignetting',
    '-ExposureCompensation',
];

// exiftool args for a second, isolated pass that extracts only the JPEG's
// embedded EXIF thumbnail. `-j` keeps the output valid JSON (ASCII text) and
// `-b` base64-encodes the binary thumbnail into that JSON, so it can travel
// through @uswriting/exiftool's text-only stdout without corruption. `-fast2`
// stops exiftool before it scans past the metadata. Kept separate from
// RECIPE_EXIFTOOL_ARGS so the text-mode recipe/camera parsers stay untouched.
export const THUMBNAIL_EXIFTOOL_ARGS = ['-b', '-j', '-fast2', '-Orientation#', '-ThumbnailImage'];

function firstExifEntry(jsonStr) {
    if (jsonStr == null || String(jsonStr).trim() === '') return null;
    let parsed;
    try {
        parsed = JSON.parse(String(jsonStr));
    } catch {
        return null;
    }
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    return entry && typeof entry === 'object' ? entry : null;
}

/**
 * Read the numeric EXIF Orientation (1-8) from a THUMBNAIL_EXIFTOOL_ARGS pass.
 * The extracted thumbnail JPEG carries no orientation of its own, so callers
 * must apply this rotation themselves. Defaults to 1 (upright, no transform)
 * for absent, non-numeric, or out-of-range values.
 * @param {string} jsonStr - exiftool `-j -Orientation#` output
 * @returns {number} an integer 1-8
 */
export function extractExifOrientation(jsonStr) {
    const entry = firstExifEntry(jsonStr);
    const value = Number(entry?.Orientation);
    return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
}

/**
 * Convert the JSON output of a THUMBNAIL_EXIFTOOL_ARGS pass into an image
 * `data:` URL suitable for an <img src>. Returns null when no usable thumbnail
 * is present or the output can't be parsed.
 * @param {string} jsonStr - exiftool `-j -b -ThumbnailImage` output
 * @returns {string|null}
 */
export function extractThumbnailDataUrl(jsonStr) {
    const entry = firstExifEntry(jsonStr);
    const raw = entry ? entry.ThumbnailImage : null;
    if (typeof raw !== 'string' || raw.trim() === '') return null;

    if (raw.startsWith('data:')) {
        return raw;
    }

    // exiftool emits binary tags in JSON as "base64:<payload>".
    const base64 = raw.startsWith('base64:') ? raw.slice('base64:'.length) : raw;
    if (base64.trim() === '') return null;

    return `data:image/jpeg;base64,${base64}`;
}

// Shared text-normalization helper: trims a raw exiftool value and treats
// blank strings and exiftool's sentinel "not applicable" forms — "(none)",
// "(n/a)", and bare "n/a" — as absent, returning null instead of the
// literal sentinel text. Used by both parseRecipeSettingsFromExif and
// parseCameraMetadataFromExif so the two parsers can't drift out of sync.
const toTextOrNull = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const s = String(v).trim();
    if (/^\((none|n\/a)\)$/i.test(s)) return null;
    if (/^n\/a$/i.test(s)) return null;
    return s;
};

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

    const firstListItem = (v) => {
        const s = toTextOrNull(v);
        if (s == null) return null;
        return toTextOrNull(s.split(';')[0]);
    };

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

    const pictureMode = getValue(/^Picture Mode\s+:([^\n]+)/m);
    const pictureModeLabel = firstListItem(pictureMode);
    const monochromeProfileSettings = toTextOrNull(getValue(/^Monochrome Profile Settings\s+:(.*)$/m));
    const hasMonochromeProfileSettings = monochromeProfileSettings != null;
    const isMonochromePictureMode = /monochrome|monotone/i.test(pictureModeLabel || '');

    const recipeType = isMonochromePictureMode ? 'MONO' : 'COLOR';

    const monochromeColor = recipeType === 'MONO' ? firstListItem(monochromeProfileSettings) : null;
    const monochromeColorStrength = recipeType === 'MONO'
        ? toSmallIntOrNull(monochromeProfileSettings?.match(/\bStrength\s+(-?\d+)/i)?.[1] || '')
        : null;
    const filmGrain = recipeType === 'MONO'
        ? toTextOrNull(getValue(/^Film Grain Effect\s+:([^\n]+)/m))
        : null;
    const filmHue = recipeType === 'MONO'
        ? toTextOrNull(getValue(/^Monochrome Color\s+:([^\n]+)/m))
        : null;
    const monochromeVignetting = recipeType === 'MONO'
        ? toTextOrNull(getValue(/^Monochrome Vignetting\s+:([^\n]+)/m))
        : null;

    // Shading Effect (-5 to +5). The camera stores this slider for BOTH color and
    // monochrome profiles in the same maker note tag, which exiftool labels
    // "Monochrome Vignetting" (Olympus tag 0x53a). It must be read regardless of
    // recipe type — gating it to MONO drops the value for every color recipe.
    const shadingEffect = toSmallIntOrNull(getValue(/^Monochrome Vignetting\s+:\s*(-?\d+)/m));

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
    const Vignette = monochromeVignetting;

    // Sharpness & Contrast: Try "Sharpness Setting" and "Contrast Setting"
    const sharpness = toSmallIntOrNull(getValue(/Sharpness Setting\s+:\s*(-?\d+)/));
    const contrast = toSmallIntOrNull(getValue(/Contrast Setting\s+:\s*(-?\d+)/));

    // Exposure Compensation
    // The legacy `ExposureCompensation` key stays a raw string (e.g. "-0.3") because
    // the OES export code (lib/oes.js) parses it directly. The DB column
    // `exposure_compensation` is a smallint in tenths of a stop, so also expose a
    // normalized integer for the upload path.
    const ExposureCompensation = getValue(/Exposure Compensation\s+:\s*([^\n]+)/);
    const exposureCompensation = (() => {
        const s = String(ExposureCompensation).trim();
        if (s === '' || /^n\/a/i.test(s)) return null;
        const stops = Number.parseFloat(s);
        if (!Number.isFinite(stops)) return null;
        return toSmallIntOrNull(Math.round(stops * 10));
    })();

    const cameraModelName = getValue(/^Camera Model Name\s+:([^\n]+)/m) || null;

    // Software tag — used to detect OM Workspace exports for upload warnings
    const software = getValue(/^Software\s+:([^\n]+)/m) || null;
    const source = [cameraModelName, software].filter((value) => !isBlank(value)).join('/') || null;

    // Assemble the object
    return {
        recipeType,

        // --- maker notes presence (used for upload validation)
        hasColorProfileSettings: !isBlank(colorProfile),
        hasMonochromeProfileSettings,
        hasToneLevel: !isBlank(toneLevel),
        isOmWorkspace: typeof software === 'string' && software.toLowerCase().includes('om workspace'),

        // --- monochrome-specific settings
        monochromeProfile: recipeType === 'MONO' ? pictureModeLabel : null,
        monochromeColor,
        monochromeColorStrength,
        filmGrain,
        filmHue,
        monochromeVignetting,

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
        shadingEffect,
        exposureCompensation,
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

/**
 * Parse general camera/exposure metadata from exiftool output — the fields
 * shown alongside sample images, independent of recipe-settings parsing.
 * @param {string} exifStr - exiftool output as a string
 * @returns {{camera: string|null, lens: string|null, shutterSpeed: string|null, aperture: string|null, focalLength: string|null, iso: string|null}}
 */
export function parseCameraMetadataFromExif(exifStr) {
    const getValue = (regex) => {
        const m = String(exifStr || '').match(regex);
        return m ? m[1].trim() : '';
    };

    return {
        camera: toTextOrNull(getValue(/^Camera Model Name\s+:([^\n]+)/m)),
        lens: toTextOrNull(getValue(/^Lens Model\s+:([^\n]+)/m)),
        shutterSpeed: toTextOrNull(getValue(/^Shutter Speed\s+:([^\n]+)/m)),
        aperture: toTextOrNull(getValue(/^Aperture\s+:([^\n]+)/m)),
        focalLength: toTextOrNull(getValue(/^Focal Length\s+:([^\n]+)/m)),
        iso: toTextOrNull(getValue(/^ISO\s+:([^\n]+)/m)),
    };
}
