export function areDetectedRecipeSettingsPropsEqual(prevProps, nextProps) {
    return prevProps.recipe === nextProps.recipe;
}

function areArraysEqual(left, right) {
    if (left === right) return true;
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

export function areSectionPreviewPropsEqual(prevProps, nextProps) {
    return prevProps.recipeId === nextProps.recipeId
        && areArraysEqual(prevProps.fileNames, nextProps.fileNames)
        && areArraysEqual(prevProps.previewUrls, nextProps.previewUrls)
        && prevProps.removeDisabled === nextProps.removeDisabled;
}

export function areSectionFormPropsEqual(prevProps, nextProps) {
    return prevProps.author === nextProps.author
        && prevProps.name === nextProps.name
        && prevProps.notes === nextProps.notes
        && prevProps.sourceUrl === nextProps.sourceUrl
        && prevProps.submitState === nextProps.submitState;
}

export function buildSectionRenderKey(batchId, sectionId) {
    return `${batchId}:${sectionId}`;
}
