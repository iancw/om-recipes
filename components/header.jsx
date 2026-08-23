import Link from 'next/link';
import { Badge } from 'components/ui/badge';
import HeaderNav from 'components/HeaderNav';

export function Header() {

    return (
        <header className="relative sticky top-0 z-40 -mx-4 mb-8 border-b border-border/70 bg-background/85 px-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <style>{`
                .nav-desktop { display: none; }
                .nav-mobile  { display: flex; }
                @media (min-width: 1024px) {
                    .nav-desktop { display: flex; }
                    .nav-mobile  { display: none; }
                }
            `}</style>
            <nav className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 py-5">
                <Link href="/" className="no-underline">
                    <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="rounded-md px-2.5 py-1 tracking-[0.22em]">
                            OM
                        </Badge>
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                                OM Recipes
                            </span>
                            <span className="text-base font-semibold text-foreground">Color Recipe Library</span>
                        </div>
                    </div>
                </Link>
                <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
                    <HeaderNav />
                </div>
            </nav>
        </header>
    );
}
