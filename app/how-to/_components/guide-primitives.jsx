import Image from 'next/image';

// Shared building blocks for the /how-to guide pages. Kept presentational and
// server-rendered — no client interactivity.

export function Step({ number, children }) {
    return (
        <div className="flex gap-4">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {number}
            </div>
            <div className="flex-1 space-y-3 pb-2">{children}</div>
        </div>
    );
}

export function StepImage({ src, alt, caption }) {
    return (
        <figure>
            <Image
                src={src}
                alt={alt}
                width={1280}
                height={800}
                sizes="(min-width: 1024px) 800px, 100vw"
                className="w-full max-w-2xl rounded-lg border border-border"
                style={{ height: 'auto' }}
            />
            {caption && (
                <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>
            )}
        </figure>
    );
}

export function Callout({ children }) {
    return (
        <div className="rounded-r-lg border-l-4 border-primary/50 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {children}
        </div>
    );
}
