'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from 'components/LogoutButton';
import LoginButton from 'components/LoginButton';
import MobileMenu from 'components/MobileMenu';
import NotificationBell from 'components/NotificationBell';
import { cn } from 'lib/cn';
import { authedNavItems, publicNavItems } from 'lib/navigation.js';

export default function HeaderNav() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        async function loadSession() {
            try {
                const response = await fetch('/auth/session', {
                    cache: 'no-store',
                    signal: controller.signal
                });
                if (!response.ok) return;

                const session = await response.json();
                setIsLoggedIn(Boolean(session?.user));
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    setIsLoggedIn(false);
                }
            }
        }

        void loadSession();

        return () => controller.abort();
    }, []);

    const visibleNavItems = isLoggedIn ? authedNavItems : publicNavItems;

    return (
        <>
            {isLoggedIn ? <NotificationBell /> : null}
            <div className="nav-desktop items-center gap-4">
                <ul className="flex flex-wrap gap-2">
                    {visibleNavItems.map((item) => (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                className={cn(
                                    'inline-flex items-center rounded-full px-3 py-2 text-sm no-underline transition-colors',
                                    'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                            >
                                {item.linkText}
                            </Link>
                        </li>
                    ))}
                </ul>
                <div>{isLoggedIn ? <LogoutButton /> : <LoginButton />}</div>
            </div>

            <div className="nav-mobile">
                <MobileMenu navItems={visibleNavItems} isLoggedIn={isLoggedIn} />
            </div>
        </>
    );
}
