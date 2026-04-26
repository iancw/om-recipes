export const LOW_MEMORY_DEVICE_GB = 4;
export const UPLOAD_PREVIEW_MAX_SIZE = 160;

export function shouldDisableUploadPreview(deviceMemory) {
    return Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= LOW_MEMORY_DEVICE_GB;
}

export async function createUploadPreviewUrl(file, maxSize = UPLOAD_PREVIEW_MAX_SIZE) {
    if (!file || typeof window === 'undefined' || typeof createImageBitmap !== 'function') {
        return null;
    }

    const bitmap = await createImageBitmap(file, {
        resizeWidth: maxSize,
        resizeHeight: maxSize,
        resizeQuality: 'low'
    });

    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const context = canvas.getContext('2d');
        if (!context) {
            return null;
        }

        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.7);
        });

        return blob ? URL.createObjectURL(blob) : null;
    } finally {
        bitmap.close?.();
    }
}
