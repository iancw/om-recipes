import Link from 'next/link';
import { cn } from 'lib/cn';
import { GUIDE_PAGES } from 'lib/guide-pages.js';

const pillBase =
    'inline-flex items-center rounded-full border px-3 py-1.5 text-sm no-underline transition-colors';

// `current` is a guide slug, or 'hub' / undefined on the how-to landing page.
export default function GuideSubNav({ current }) {
    const items = [{ slug: 'hub', href: '/how-to', label: 'All guides' }, ...GUIDE_PAGES];

    return (
        <nav aria-label="Guides" className="flex flex-wrap gap-2">
            {items.map((item) => {
                const isCurrent = item.slug === current;
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={cn(
                            pillBase,
                            isCurrent
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
