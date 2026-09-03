// Rights an image that carries an EXIF orientation but whose pixels are stored
// rotated/flipped — used for the extracted JPEG thumbnail on the upload review,
// which is a bare JPEG with no orientation of its own.
//
// This bakes the rotation into a fresh (tiny) canvas rather than applying a CSS
// `transform` to the <img>. A rotated <img> inside an `overflow:hidden` +
// `border-radius` + `object-cover` box makes mobile Safari allocate a runaway
// compositing layer and the OS then reaps the tab. Re-encoding a 160×120
// thumbnail costs a few KB and sidesteps that entirely.

// EXIF orientation → 2D-context transform matrix [a,b,c,d,e,f] that draws a
// `width`×`height` source upright. Orientations 5-8 rotate 90°/270°, so the
// output canvas swaps width and height.
export function canvasOrientationOps(orientation, width, height) {
    const swap = orientation >= 5 && orientation <= 8;
    const matrices = {
        1: [1, 0, 0, 1, 0, 0],
        2: [-1, 0, 0, 1, width, 0],
        3: [-1, 0, 0, -1, width, height],
        4: [1, 0, 0, -1, 0, height],
        5: [0, 1, 1, 0, 0, 0],
        6: [0, 1, -1, 0, height, 0],
        7: [0, -1, -1, 0, height, width],
        8: [0, -1, 1, 0, 0, width]
    };

    return {
        canvasWidth: swap ? height : width,
        canvasHeight: swap ? width : height,
        matrix: matrices[orientation] || matrices[1]
    };
}

/**
 * Return a new `data:` URL for `dataUrl` re-encoded upright for the given EXIF
 * `orientation` (1-8). Returns the input unchanged for orientation 1, outside a
 * browser, or on any failure — the caller always gets a usable value.
 * @param {string|null} dataUrl
 * @param {number} orientation
 * @returns {Promise<string|null>}
 */
export async function orientImageDataUrl(dataUrl, orientation) {
    if (!dataUrl || !orientation || orientation === 1) return dataUrl;
    if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;

    try {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const { canvasWidth, canvasHeight, matrix } = canvasOrientationOps(
            orientation,
            img.naturalWidth,
            img.naturalHeight
        );

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        const context = canvas.getContext('2d');
        if (!context) return dataUrl;

        context.setTransform(...matrix);
        context.drawImage(img, 0, 0);

        return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
        return dataUrl;
    }
}
