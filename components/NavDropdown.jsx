'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'lib/cn';

// Desktop header dropdown for a nav item that groups sub-pages (e.g. "Guides").
// Click the trigger to toggle; closes on outside click, Escape, or selecting an
// item. The trigger shows the active style while the current route is one of
// its items.
export default function NavDropdown({ label, items }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const panelId = useId();
    const pathname = usePathname();

    const isActive = items.some(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
    );

    useEffect(() => {
        if (!open) return undefined;

        const onPointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={panelId}
                data-active={isActive}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm no-underline transition-colors',
                    isActive || open
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
            >
                {label}
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                    className={cn('transition-transform', open && 'rotate-180')}
                >
                    <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            <div
                id={panelId}
                role="menu"
                hidden={!open}
                className="absolute right-0 z-50 mt-2 min-w-56 rounded-xl border border-border bg-card p-1 text-card-foreground shadow-xl"
            >
                {items.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        aria-current={pathname === item.href ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                            'block rounded-lg px-3 py-2 text-sm no-underline transition-colors',
                            pathname === item.href
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        {item.linkText}
                    </Link>
                ))}
            </div>
        </div>
    );
}
