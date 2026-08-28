import crypto from 'node:crypto';

function normInt(v) {
    if (v == null) return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.trunc(n);
}

function normStr(v) {
    const s = String(v ?? '').trim();
    return s || null;
}

function hasValue(v) {
    return v != null && String(v).trim() !== '';
}

function hasNonZeroValue(v) {
    return hasValue(v) && normInt(v) !== 0;
}

function hasColorPayload(recipeSettings) {
    return [
        recipeSettings?.yellow,
        recipeSettings?.orange,
        recipeSettings?.orangeRed,
        recipeSettings?.red,
        recipeSettings?.magenta,
        recipeSettings?.violet,
        recipeSettings?.blue,
        recipeSettings?.blueCyan,
        recipeSettings?.cyan,
        recipeSettings?.greenCyan,
        recipeSettings?.green,
        recipeSettings?.yellowGreen
    ].some(hasNonZeroValue);
}

function hasMonoPayload(recipeSettings) {
    return [
        recipeSettings?.monochromeProfile,
        recipeSettings?.monochromeColor,
        recipeSettings?.filmGrain,
        recipeSettings?.filmHue,
        recipeSettings?.monochromeVignetting,
        recipeSettings?.monochromeColorStrength
    ].some((value) => {
        if (typeof value === 'string') return normStr(value) != null;
        return hasValue(value);
    });
}

function normWhiteBalance(v) {
    const s = normStr(v);
    if (s == null) return null;
    // Treat "Auto" and "Auto (Keep Warm Colors)" as equivalent
    if (s.toLowerCase().startsWith('auto')) return 'auto';
    return s;
}

function colorPayload(s) {
    return {
        yellow: normInt(s?.yellow),
        orange: normInt(s?.orange),
        orangeRed: normInt(s?.orangeRed),
        red: normInt(s?.red),
        magenta: normInt(s?.magenta),
        violet: normInt(s?.violet),
        blue: normInt(s?.blue),
        blueCyan: normInt(s?.blueCyan),
        cyan: normInt(s?.cyan),
        greenCyan: normInt(s?.greenCyan),
        green: normInt(s?.green),
        yellowGreen: normInt(s?.yellowGreen)
    };
}

function monoPayload(s) {
    return {
        monochromeProfile: normStr(s?.monochromeProfile),
        monochromeColor: normStr(s?.monochromeColor),
        monochromeColorStrength: normInt(s?.monochromeColorStrength),
        filmGrain: normStr(s?.filmGrain),
        filmHue: normStr(s?.filmHue),
        monochromeVignetting: normStr(s?.monochromeVignetting)
    };
}

export function getRecipeType(recipeSettings) {
    const explicitType = normStr(recipeSettings?.recipeType)?.toUpperCase();
    const monoPayloadPresent = hasMonoPayload(recipeSettings);
    const colorPayloadPresent = hasColorPayload(recipeSettings);
    if (explicitType === 'MONO') {
        if (monoPayloadPresent) return 'MONO';
        if (colorPayloadPresent) return 'COLOR';
    }
    if (explicitType === 'COLOR') {
        if (colorPayloadPresent) return 'COLOR';
        if (monoPayloadPresent) return 'MONO';
    }

    return monoPayloadPresent ? 'MONO' : 'COLOR';
}

function typePayload(recipeSettings) {
    return getRecipeType(recipeSettings) === 'MONO'
        ? monoPayload(recipeSettings)
        : colorPayload(recipeSettings);
}

function sha256(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Legacy partial fingerprint helper. Branches by recipe type so current callers
 * continue to work once monochrome recipes enter the pipeline.
 */
export function computeColorFingerprint(recipeSettings) {
    return sha256(typePayload(recipeSettings));
}

export function computeMonoFingerprint(recipeSettings) {
    return sha256(monoPayload(recipeSettings));
}

/**
 * Legacy tone partial fingerprint helper. Branches by recipe type so current callers
 * continue to work once monochrome recipes enter the pipeline.
 * Excludes contrast, sharpness, and white balance.
 */
export function computeColorToneFingerprint(recipeSettings) {
    return sha256({
        ...typePayload(recipeSettings),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeMonoToneFingerprint(recipeSettings) {
    return sha256({
        ...monoPayload(recipeSettings),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

/**
 * Legacy no-WB partial fingerprint helper. Branches by recipe type so current callers
 * continue to work once monochrome recipes enter the pipeline.
 */
export function computeNoWbFingerprint(recipeSettings) {
    return sha256({
        ...typePayload(recipeSettings),
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeMonoNoWbFingerprint(recipeSettings) {
    return sha256({
        ...monoPayload(recipeSettings),
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

/**
 * Fingerprint: all settings (type-specific controls + shared sliders + white balance).
 * Intentionally EXCLUDES shadingEffect and exposureCompensation.
 */
export function computeRecipeFingerprint(recipeSettings) {
    const payload = {
        ...typePayload(recipeSettings),

        // Sliders
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones),

        // White balance
        whiteBalanceTemperature: normInt(recipeSettings?.whiteBalanceTemperature),
        whiteBalanceAmberOffset: normInt(recipeSettings?.whiteBalanceAmberOffset),
        whiteBalanceGreenOffset: normInt(recipeSettings?.whiteBalanceGreenOffset)
    };

    return sha256(payload);
}
