'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from 'lib/cn';
import { buttonVariants } from 'components/ui/button';
import { getRecipePath } from 'lib/recipe-url.js';

function describeNotification(item) {
    const recipeName = item.recipe?.recipeName ?? 'a recipe';
    const actorName = item.actorAuthorName ?? 'Someone';

    if (item.type === 'sample_image_added') return `${actorName} added a sample image to ${recipeName}`;
    if (item.type === 'recipe_saved') return `${actorName} saved ${recipeName}`;
    if (item.type === 'new_recipe') return `New recipe: ${recipeName} by ${actorName}`;
    return recipeName;
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [items, setItems] = useState([]);
    const containerRef = useRef(null);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch('/api/notifications', { cache: 'no-store' });
            if (!response.ok) return null;
            const data = await response.json();
            setItems(data.items ?? []);
            setUnreadCount(data.unreadCount ?? 0);
            setLoaded(true);
            return data;
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            void refresh();
        }, 0);
        const interval = setInterval(refresh, 60000);
        return () => {
            clearTimeout(timeoutId);
            clearInterval(interval);
        };
    }, [refresh]);

    useEffect(() => {
        if (!open) return undefined;

        function handleClickOutside(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const handleToggle = async () => {
        const next = !open;
        setOpen(next);
        if (!next) return;

        const data = await refresh();
        if (data && data.unreadCount > 0) {
            setUnreadCount(0);
            fetch('/api/notifications/read', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
            }).catch(() => {});
        }
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={handleToggle}
                aria-label="Notifications"
                aria-expanded={open}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
            >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                        d="M10 2a5 5 0 0 0-5 5v2.5c0 .7-.25 1.38-.7 1.92L3 13h14l-1.3-1.58c-.45-.54-.7-1.22-.7-1.92V7a5 5 0 0 0-5-5Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                    />
                    <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {unreadCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                ) : null}
            </button>

            {open ? (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-border/70 bg-card p-2 shadow-lg">
                    {!loaded ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
                    ) : items.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">No notifications yet.</p>
                    ) : (
                        <ul className="max-h-96 overflow-y-auto">
                            {items.map((item) => (
                                <li key={item.id}>
                                    <Link
                                        href={item.recipe ? getRecipePath(item.recipe) : '/'}
                                        onClick={() => setOpen(false)}
                                        className="block rounded-lg px-3 py-2 text-sm text-foreground no-underline hover:bg-accent/60"
                                    >
                                        {describeNotification(item)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </div>
    );
}
