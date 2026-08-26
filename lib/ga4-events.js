export function trackGA4Event(name, params = {}) {
    if (typeof window === 'undefined') return;
    if (typeof window.gtag !== 'function') return;

    window.gtag('event', name, params);
}
