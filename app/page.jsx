import Link from 'next/link';

import HomeCatalog from './HomeCatalog.jsx';
import { getRecipeLinkIndex } from '../lib/public-recipe-catalog.js';
import { getRecipePath } from '../lib/recipe-url.js';

export default async function Page() {
    const recipeLinkIndex = await getRecipeLinkIndex();

    return (
        <>
            <HomeCatalog />

            {recipeLinkIndex.length > 0 ? (
                <nav aria-label="All recipes" className="mt-2 border-t border-border/60 pb-10 pt-8">
                    <h2 className="text-lg font-medium text-foreground">Browse all recipes</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        A plain index of every recipe in the catalog, in case you would rather scan than filter.
                    </p>
                    <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                        {recipeLinkIndex.map((recipe) => (
                            <li key={recipe.slug} className="text-sm leading-6">
                                <Link
                                    href={getRecipePath(recipe)}
                                    className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                                >
                                    {recipe.recipeName}
                                </Link>
                                <span className="text-muted-foreground"> · {recipe.authorName}</span>
                            </li>
                        ))}
                    </ul>
                </nav>
            ) : null}
        </>
    );
}
