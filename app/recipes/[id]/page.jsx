import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '../../../lib/auth.js';
import { getUserSavedState } from '../../../lib/user-state-cache.js';
import RecipeCard from '../../../components/recipe-card.jsx';
import SampleGallery from '../../../components/SampleGallery.jsx';
import CommentsSection from '../../../components/CommentsSection.jsx';
import { Badge } from '../../../components/ui/badge.jsx';
import { Card, CardContent } from '../../../components/ui/card.jsx';
import {
    addCommentAction,
    deleteCommentAction,
    deleteMyRecipeAction,
    deleteRecipeSampleImageAction,
    setPrimaryRecipeSampleImageAction,
    updateRecipeAction
} from './actions';
import { getSaveCountForRecipe } from '../../../lib/recipe-saves.js';
import { resolveRecipeIndexEntry, findRelatedWhiteBalanceRecipes } from '../../../lib/public-recipe-catalog.js';
import { getCachedRecipeDetail } from '../../../lib/recipe-detail-cache.js';
import { getRecipePath } from '../../../lib/recipe-url.js';
import { getEquivalentWhiteBalance } from '../../../lib/whiteBalanceEquivalence.js';
import { JsonLd } from '../../../components/JsonLd.jsx';
import { buildRecipeJsonLd } from '../../../lib/structured-data.js';

const getRecipeByIdOrSlug = cache(async function getRecipeByIdOrSlug(idOrSlug, userId = null) {
    const v = String(idOrSlug ?? '').trim();
    if (!v) return null;

    const indexEntry = await resolveRecipeIndexEntry(v);
    if (!indexEntry) return null;

    const detail = await getCachedRecipeDetail(indexEntry.id);
    if (!detail) return null;

    return {
        ...detail,
        // Use the index entry's slug (the same source /recipes/resolve uses
        // for canonical-redirect decisions), not the detail cache's, so this
        // page's own redirect check below is structurally unable to diverge
        // from /recipes/resolve.
        slug: indexEntry.slug,
        viewerIsLoggedIn: userId != null,
        // Defaults false; Page() below overrides this from the per-user
        // saved-state cache for logged-in viewers.
        isSaved: false
    };
});

export async function generateMetadata({ params }) {
    const resolvedParams = await params;
    const id = decodeURIComponent(resolvedParams?.id ?? '');
    const recipe = await getRecipeByIdOrSlug(id, null);
    if (!recipe) return {};

    const title = recipe.recipeName;
    const description = recipe.description?.trim()
        || `${recipe.type === 'MONO' ? 'Monochrome' : 'Color'} recipe for OM System / Olympus cameras by ${recipe.authorName}.`;

    const primaryImage = recipe.sampleImages?.find((img) => img.isPrimary) ?? recipe.sampleImages?.[0] ?? null;
    // Use the 1200px rendition, not the camera original: originals can run
    // several MB and Facebook's link-preview scraper silently drops images
    // over its ~8MB fetch limit, leaving a blank preview box.
    const ogImageUrl = primaryImage?.assetUrls?.['1200'] ?? primaryImage?.assetUrls?.original ?? null;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            ...(ogImageUrl ? { images: [{ url: ogImageUrl }] } : {})
        }
    };
}

export default async function Page({ params }) {
    // Next.js 16+ passes `params` as a Promise in some runtimes.
    // https://nextjs.org/docs/messages/sync-dynamic-apis
    const resolvedParams = await params;
    const id = decodeURIComponent(resolvedParams?.id ?? '');
    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const recipe = await getRecipeByIdOrSlug(id, userId);
    if (!recipe) return notFound();
    // Any non-canonical identifier (old slug alias or uuid) redirects to the current slug.
    if (recipe.slug && id && id !== recipe.slug) {
        permanentRedirect(getRecipePath(recipe));
    }
    let authorIds = [];
    if (session?.user?.uuid) {
        const userState = await getUserSavedState(session.user.uuid, userId);
        recipe.isSaved = userState.savedRecipeIds.includes(recipe.id);
        authorIds = userState.authorIds ?? [];
    }
    const whiteBalance = getEquivalentWhiteBalance(recipe);
    const relatedWhiteBalanceRecipes = await findRelatedWhiteBalanceRecipes(recipe.id, whiteBalance, recipe.type);

    const isOwner = authorIds.includes(recipe.authorId);
    const saveCount = isOwner ? await getSaveCountForRecipe(recipe.id) : null;
    const recipeComments = recipe.comments ?? [];

    return (
        <div className="flex w-full flex-col gap-8 pb-10 pt-2">
            <JsonLd data={buildRecipeJsonLd({ recipe, baseUrl: process.env.APP_BASE_URL })} />
            <div>
                <RecipeCard
                    recipe={recipe}
                    isOwner={isOwner}
                    saveCount={saveCount}
                    updateRecipeAction={updateRecipeAction}
                    deleteRecipeAction={deleteMyRecipeAction}
                />
            </div>

            <div className="space-y-8">
                <SampleGallery
                    images={recipe.sampleImages}
                    title="Sample images"
                    canDelete={isOwner}
                    canSetPrimary={isOwner}
                    recipeId={recipe.id}
                    recipeName={recipe.recipeName}
                    deleteImageAction={deleteRecipeSampleImageAction}
                    setPrimaryImageAction={setPrimaryRecipeSampleImageAction}
                />
                <SampleGallery images={recipe.comparisonImages} title="Comparison images" recipeName={recipe.recipeName} />
            </div>

            <CommentsSection
                recipeId={recipe.id}
                recipePath={getRecipePath(recipe)}
                comments={recipeComments}
                isLoggedIn={Boolean(userId)}
                viewerAuthorIds={authorIds}
                recipeAuthorId={recipe.authorId}
                addCommentAction={addCommentAction}
                deleteCommentAction={deleteCommentAction}
            />

            {relatedWhiteBalanceRecipes.length > 0 ? (
                <Card className="overflow-hidden border-border/60 bg-card/80">
                    <CardContent className="space-y-4 p-6">
                        <div className="space-y-2">
                            <Badge variant="secondary">Related Recipes</Badge>
                            <div className="space-y-1">
                                <h2 className="text-2xl">White Balance Compatibility</h2>
                                <p className="text-sm leading-6 text-muted-foreground">
                                    Other recipes using the same effective white balance settings.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {relatedWhiteBalanceRecipes.map((relatedRecipe) => (
                                <Link
                                    key={relatedRecipe.id}
                                    href={getRecipePath(relatedRecipe)}
                                    className="rounded-full border border-border/70 bg-muted/30 px-4 py-2 text-sm transition-colors hover:border-primary/35 hover:text-foreground"
                                >
                                    {relatedRecipe.recipeName}
                                    <span className="ml-2 text-muted-foreground">{relatedRecipe.authorName}</span>
                                </Link>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}
