'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Alert } from 'components/alert';
import { Button, buttonVariants } from 'components/ui/button';
import { cn } from 'lib/cn';

const DISMISSED_STORAGE_KEY = 'om-recipes:contribute-banner-dismissed';

function readDismissed() {
    try {
        return window.localStorage.getItem(DISMISSED_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function persistDismissed() {
    try {
        window.localStorage.setItem(DISMISSED_STORAGE_KEY, '1');
    } catch {
        // Ignore storage failures (private mode, blocked cookies) — the banner
        // simply reappears on the next visit.
    }
}

function subscribeToStorage(onChange) {
    window.addEventListener('storage', onChange);
    return () => window.removeEventListener('storage', onChange);
}

// Treat the banner as dismissed during SSR so the server renders nothing and
// there is no flash for visitors who dismissed it on a previous visit; the
// client reconciles to the real localStorage value after hydration.
const getServerDismissed = () => true;

export function ContributeSamplesBannerContent({ onDismiss }) {
    return (
        <Alert className="flex-col items-start sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl space-y-1">
                <p className="font-medium text-foreground">Add your photos to the library.</p>
                <p className="text-sm text-muted-foreground">
                    Adding yours is as easy as dropping a straight-out-of-camera JPG on the upload
                    page — we read the recipe baked into the file and either attach your shot as a
                    sample to the matching recipe or create a brand-new recipe from it.
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <Link href="/upload" className={cn(buttonVariants(), 'no-underline whitespace-nowrap')}>
                    Upload a JPG
                </Link>
                <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss}>
                    ×
                </Button>
            </div>
        </Alert>
    );
}

export default function ContributeSamplesBanner() {
    const storedDismissed = useSyncExternalStore(subscribeToStorage, readDismissed, getServerDismissed);
    // A same-tab dismiss does not fire the `storage` event, so track it locally.
    const [dismissedHere, setDismissedHere] = useState(false);

    const dismiss = useCallback(() => {
        setDismissedHere(true);
        persistDismissed();
    }, []);

    if (storedDismissed || dismissedHere) return null;

    return <ContributeSamplesBannerContent onDismiss={dismiss} />;
}
