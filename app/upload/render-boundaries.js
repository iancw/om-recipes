export function areUploadPreviewPropsEqual(prevProps, nextProps) {
    return prevProps.fileName === nextProps.fileName
        && prevProps.previewUrl === nextProps.previewUrl
        && prevProps.disablePreview === nextProps.disablePreview
        && prevProps.isPreparingPreview === nextProps.isPreparingPreview
        && prevProps.onRemoveImage === nextProps.onRemoveImage;
}

export function areDetectedRecipeSettingsPropsEqual(prevProps, nextProps) {
    return prevProps.recipe === nextProps.recipe;
}
