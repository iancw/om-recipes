export const LOW_MEMORY_DEVICE_GB = 4;
export const UPLOAD_PREVIEW_MAX_SIZE = 160;
export const MOBILE_SAFARI_PREVIEW_FILE_LIMIT = 1;

function isLikelyMobileSafari(userAgent) {
    const normalizedUserAgent = String(userAgent || '');
    if (!normalizedUserAgent) {
        return false;
    }

    const isAppleMobileDevice = /iPhone|iPad|iPod/i.test(normalizedUserAgent);
    const isSafariEngine = /Safari/i.test(normalizedUserAgent) && /AppleWebKit/i.test(normalizedUserAgent);
    const isAlternativeIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(normalizedUserAgent);

    return isAppleMobileDevice && isSafariEngine && !isAlternativeIosBrowser;
}

export function shouldDisableUploadPreview(deviceMemoryOrOptions) {
    const options =
        deviceMemoryOrOptions && typeof deviceMemoryOrOptions === 'object'
            ? deviceMemoryOrOptions
            : { deviceMemory: deviceMemoryOrOptions };
    const { deviceMemory, fileCount = 0, userAgent } = options;

    return (
        (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= LOW_MEMORY_DEVICE_GB)
        || (
            !Number.isFinite(deviceMemory)
            && fileCount > MOBILE_SAFARI_PREVIEW_FILE_LIMIT
            && isLikelyMobileSafari(userAgent)
        )
    );
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

export async function createUploadPreviewUrls(files, { createPreviewUrl = createUploadPreviewUrl } = {}) {
    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }

    const previewUrls = [];

    for (const file of files) {
        try {
            previewUrls.push(await createPreviewUrl(file));
        } catch {
            previewUrls.push(null);
        }
    }

    return previewUrls;
}
