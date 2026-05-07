const FALLBACK_ORIGIN = 'https://om-recipes.local';

function hasAbsoluteUrl(value) {
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

export function buildRetryableImageUrl(src, attempt) {
    const normalizedSrc = String(src ?? '').trim();
    if (!normalizedSrc || attempt <= 0) return normalizedSrc;

    const absolute = hasAbsoluteUrl(normalizedSrc);
    const url = new URL(normalizedSrc, absolute ? undefined : FALLBACK_ORIGIN);
    url.searchParams.set('retry', String(attempt));

    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export function startImageAvailabilityPolling({
    src,
    intervalMs = 5000,
    maxDurationMs = Number.POSITIVE_INFINITY,
    createImage,
    onAvailable,
    onExhausted
}) {
    const normalizedSrc = String(src ?? '').trim();
    if (!normalizedSrc || typeof createImage !== 'function') {
        return () => {};
    }

    let stopped = false;
    let timerId = null;
    let attempt = 0;
    let elapsedMs = 0;

    const clearPendingTimer = () => {
        if (timerId != null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };

    const scheduleProbe = () => {
        if (elapsedMs >= maxDurationMs) {
            onExhausted?.();
            return;
        }

        clearPendingTimer();
        timerId = setTimeout(() => {
            if (stopped) return;

            elapsedMs += intervalMs;
            attempt += 1;
            const probe = createImage();
            if (!probe) return;

            probe.onload = () => {
                if (stopped) return;
                clearPendingTimer();
                onAvailable?.(attempt);
            };

            probe.onerror = () => {
                if (stopped) return;

                if (elapsedMs >= maxDurationMs) {
                    clearPendingTimer();
                    onExhausted?.();
                    return;
                }

                scheduleProbe();
            };

            probe.src = buildRetryableImageUrl(normalizedSrc, attempt);
        }, intervalMs);
    };

    scheduleProbe();

    return () => {
        stopped = true;
        clearPendingTimer();
    };
}
