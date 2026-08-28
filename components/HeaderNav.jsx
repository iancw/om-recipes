'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from 'components/LogoutButton';
import LoginButton from 'components/LoginButton';
import MobileMenu from 'components/MobileMenu';
import NavDropdown from 'components/NavDropdown';
import NotificationBell from 'components/NotificationBell';
import { cn } from 'lib/cn';
import { authedNavItems, publicNavItems } from 'lib/navigation.js';

// Keep in sync with the `.nav-desktop` / `.nav-mobile` breakpoint in components/header.jsx.
const DESKTOP_NAV_QUERY = '(min-width: 1024px)';

function useIsDesktopNav() {
    const [isDesktop, setIsDesktop] = useState(false);

    useLayoutEffect(() => {
        const mql = window.matchMedia(DESKTOP_NAV_QUERY);
        const update = () => setIsDesktop(mql.matches);
        update();
        mql.addEventListener('change', update);
        return () => mql.removeEventListener('change', update);
    }, []);

    return isDesktop;
}

export default function HeaderNav() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const isDesktop = useIsDesktopNav();

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
    const notificationBell = isLoggedIn ? <NotificationBell /> : null;

    return (
        <>
            <div className="nav-desktop items-center gap-4">
                <ul className="flex flex-wrap items-center gap-2">
                    {visibleNavItems.map((item) => (
                        <li key={item.href ?? item.linkText}>
                            {item.children ? (
                                <NavDropdown label={item.linkText} items={item.children} />
                            ) : (
                                <Link
                                    href={item.href}
                                    className={cn(
                                        'inline-flex items-center rounded-full px-3 py-2 text-sm no-underline transition-colors',
                                        'text-muted-foreground hover:bg-accent hover:text-foreground'
                                    )}
                                >
                                    {item.linkText}
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>
                {isDesktop ? notificationBell : null}
                <div>{isLoggedIn ? <LogoutButton /> : <LoginButton />}</div>
            </div>

            <div className="nav-mobile flex-wrap items-center justify-end gap-2">
                {isDesktop ? null : notificationBell}
                <MobileMenu navItems={visibleNavItems} isLoggedIn={isLoggedIn} />
            </div>
        </>
    );
}
