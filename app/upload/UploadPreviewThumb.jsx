import React, { memo } from 'react';

import { areUploadPreviewPropsEqual } from './render-boundaries.js';

function UploadPreviewThumb({
    fileName,
    previewUrl,
    disablePreview,
    isPreparingPreview,
    onRemoveImage
}) {
    if (!fileName) return null;

    const handleRemoveClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemoveImage();
    };

    return (
        <div className="mt-2 inline-flex flex-col items-start gap-2">
            <div className="relative inline-block">
                {!!previewUrl && !disablePreview && (
                    <img
                        src={previewUrl}
                        alt="Preview"
                        className="block max-h-[120px] max-w-[120px] rounded-xl border border-border/60 object-cover"
                    />
                )}
                {!previewUrl && !disablePreview && isPreparingPreview && (
                    <p className="mt-1 text-xs text-muted-foreground">Preparing preview…</p>
                )}
                {disablePreview && (
                    <p className="mt-1 max-w-[120px] text-xs text-muted-foreground">
                        Preview is disabled on this device to reduce memory use during upload.
                    </p>
                )}
                <button
                    type="button"
                    aria-label="Remove image"
                    title="Remove image"
                    onClick={handleRemoveClick}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card/95 text-sm leading-none shadow-sm"
                >
                    ×
                </button>
            </div>
            <button
                type="button"
                onClick={handleRemoveClick}
                className="text-xs font-medium text-foreground underline underline-offset-4"
            >
                Remove image
            </button>
        </div>
    );
}

export default memo(UploadPreviewThumb, areUploadPreviewPropsEqual);
