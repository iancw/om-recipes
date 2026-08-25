import { eq } from 'drizzle-orm';

import { authors, recipeColorSettings, recipeMonoSettings, recipes } from '../db/schema.ts';

export const RECIPE_TYPE_FILTERS = Object.freeze({
    ALL: 'ALL',
    COLOR: 'COLOR',
    MONO: 'MONO'
});
export const RECIPE_TYPE_FILTER_VALUES = RECIPE_TYPE_FILTERS;

const COLOR_SETTING_KEYS = [
    'yellow',
    'orange',
    'orangeRed',
    'red',
    'magenta',
    'violet',
    'blue',
    'blueCyan',
    'cyan',
    'greenCyan',
    'green',
    'yellowGreen'
];

const SHARED_SETTING_KEYS = [
    'contrast',
    'sharpness',
    'highlights',
    'shadows',
    'midtones',
    'shadingEffect',
    'exposureCompensation',
    'whiteBalance2',
    'whiteBalanceTemperature',
    'whiteBalanceAmberOffset',
    'whiteBalanceGreenOffset'
];

const MONO_SETTING_KEYS = [
    'monochromeProfile',
    'monochromeColor',
    'monochromeColorStrength',
    'filmGrain',
    'filmHue',
    'monochromeVignetting'
];

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined) return value;
    }
    return undefined;
}

function normalizeOptionalValue(value) {
    return value === undefined ? null : value;
}

export function normalizeRecipeType(value) {
    return String(value ?? '').trim().toUpperCase() === RECIPE_TYPE_FILTERS.MONO
        ? RECIPE_TYPE_FILTERS.MONO
        : RECIPE_TYPE_FILTERS.COLOR;
}

export function normalizeRecipeTypeFilter(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized === RECIPE_TYPE_FILTERS.COLOR || normalized === RECIPE_TYPE_FILTERS.MONO
        ? normalized
        : RECIPE_TYPE_FILTERS.ALL;
}

export function buildRecipeSelectFields({ includeAuthorId = false, includeAuthorSocial = false, authorTable = authors } = {}) {
    return {
        id: recipes.id,
        uuid: recipes.uuid,
        slug: recipes.slug,
        type: recipes.type,
        recipeName: recipes.recipeName,
        authorName: recipes.authorName,
        description: recipes.description,
        sourceUrl: recipes.sourceUrl,
        createdAt: recipes.createdAt,

        yellow: recipes.yellow,
        orange: recipes.orange,
        orangeRed: recipes.orangeRed,
        red: recipes.red,
        magenta: recipes.magenta,
        violet: recipes.violet,
        blue: recipes.blue,
        blueCyan: recipes.blueCyan,
        cyan: recipes.cyan,
        greenCyan: recipes.greenCyan,
        green: recipes.green,
        yellowGreen: recipes.yellowGreen,

        contrast: recipes.contrast,
        sharpness: recipes.sharpness,
        highlights: recipes.highlights,
        shadows: recipes.shadows,
        midtones: recipes.midtones,
        shadingEffect: recipes.shadingEffect,
        exposureCompensation: recipes.exposureCompensation,
        whiteBalance2: recipes.whiteBalance2,
        whiteBalanceTemperature: recipes.whiteBalanceTemperature,
        whiteBalanceAmberOffset: recipes.whiteBalanceAmberOffset,
        whiteBalanceGreenOffset: recipes.whiteBalanceGreenOffset,

        ...(includeAuthorId ? { authorId: recipes.authorId } : {}),
        ...(includeAuthorSocial
            ? {
                  authorSocial: {
                      instagram: authorTable.instagramLink,
                      flickr: authorTable.flickrLink,
                      website: authorTable.website,
                      kofi: authorTable.kofiLink
                  }
              }
            : {}),
        colorSettings: {
            yellow: recipeColorSettings.yellow,
            orange: recipeColorSettings.orange,
            orangeRed: recipeColorSettings.orangeRed,
            red: recipeColorSettings.red,
            magenta: recipeColorSettings.magenta,
            violet: recipeColorSettings.violet,
            blue: recipeColorSettings.blue,
            blueCyan: recipeColorSettings.blueCyan,
            cyan: recipeColorSettings.cyan,
            greenCyan: recipeColorSettings.greenCyan,
            green: recipeColorSettings.green,
            yellowGreen: recipeColorSettings.yellowGreen,
            contrast: recipeColorSettings.contrast,
            sharpness: recipeColorSettings.sharpness,
            highlights: recipeColorSettings.highlights,
            shadows: recipeColorSettings.shadows,
            midtones: recipeColorSettings.midtones,
            shadingEffect: recipeColorSettings.shadingEffect,
            exposureCompensation: recipeColorSettings.exposureCompensation,
            whiteBalance2: recipeColorSettings.whiteBalance2,
            whiteBalanceTemperature: recipeColorSettings.whiteBalanceTemperature,
            whiteBalanceAmberOffset: recipeColorSettings.whiteBalanceAmberOffset,
            whiteBalanceGreenOffset: recipeColorSettings.whiteBalanceGreenOffset
        },
        monoSettings: {
            monochromeProfile: recipeMonoSettings.monochromeProfile,
            monochromeColor: recipeMonoSettings.monochromeColor,
            monochromeColorStrength: recipeMonoSettings.monochromeColorStrength,
            filmGrain: recipeMonoSettings.filmGrain,
            filmHue: recipeMonoSettings.filmHue,
            monochromeVignetting: recipeMonoSettings.monochromeVignetting,
            contrast: recipeMonoSettings.contrast,
            sharpness: recipeMonoSettings.sharpness,
            highlights: recipeMonoSettings.highlights,
            shadows: recipeMonoSettings.shadows,
            midtones: recipeMonoSettings.midtones,
            shadingEffect: recipeMonoSettings.shadingEffect,
            exposureCompensation: recipeMonoSettings.exposureCompensation,
            whiteBalance2: recipeMonoSettings.whiteBalance2,
            whiteBalanceTemperature: recipeMonoSettings.whiteBalanceTemperature,
            whiteBalanceAmberOffset: recipeMonoSettings.whiteBalanceAmberOffset,
            whiteBalanceGreenOffset: recipeMonoSettings.whiteBalanceGreenOffset
        }
    };
}

export const getRecipeSelectFields = buildRecipeSelectFields;

export function withRecipeSettings(query) {
    return query
        .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id));
}

export function normalizeRecipeRow(row) {
    if (!row) return row;

    const { colorSettings, monoSettings, ...recipe } = row;
    const type = normalizeRecipeType(recipe.type);
    const activeSettings = type === RECIPE_TYPE_FILTERS.MONO ? monoSettings : colorSettings;

    const normalized = {
        ...recipe,
        type,
        supportsOesDownload: true
    };

    for (const key of COLOR_SETTING_KEYS) {
        normalized[key] = type === RECIPE_TYPE_FILTERS.COLOR
            ? normalizeOptionalValue(firstDefined(activeSettings?.[key], recipe[key]))
            : null;
    }

    for (const key of SHARED_SETTING_KEYS) {
        normalized[key] = normalizeOptionalValue(firstDefined(activeSettings?.[key], recipe[key]));
    }

    for (const key of MONO_SETTING_KEYS) {
        normalized[key] = type === RECIPE_TYPE_FILTERS.MONO
            ? normalizeOptionalValue(firstDefined(monoSettings?.[key], recipe[key]))
            : null;
    }

    return normalized;
}
