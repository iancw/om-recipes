import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '../../../lib/auth.js';
import { db } from '../../../db/index.ts';
import {
    authors,
    images,
    recipeColorSettings,
    recipeComparisonImages,
    recipeMonoSettings,
    recipeSampleImages,
    recipes
} from '../../../db/schema.ts';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import RecipeCard from '../../../components/recipe-card.jsx';
import SampleGallery from '../../../components/SampleGallery.jsx';
import { Badge } from '../../../components/ui/badge.jsx';
import { Card, CardContent } from '../../../components/ui/card.jsx';
import {
    deleteMyRecipeAction,
    deleteRecipeSampleImageAction,
    setPrimaryRecipeSampleImageAction,
    updateRecipeAction
} from './actions';
import { getSavedRecipeIdsForUser, getSaveCountForRecipe } from '../../../lib/recipe-saves.js';
import { getRecipeSelectFields, normalizeRecipeRow } from '../../../lib/recipe-data.js';
import { hydrateRecipeImageRecord } from '../../../lib/recipe-image-assets.js';
import { getRecipePath, isUuidLike } from '../../../lib/recipe-url.js';
import { getEquivalentWhiteBalance } from '../../../lib/whiteBalanceEquivalence.js';

const getRecipeByIdOrSlug = cache(async function getRecipeByIdOrSlug(idOrSlug, userId = null) {
    const v = String(idOrSlug ?? '').trim();
    if (!v) return null;
    // Detect UUID format to avoid a Postgres type error when the param is a slug.
    const isUuid = isUuidLike(v);
    const rows = await db
        .select(
            getRecipeSelectFields({
                includeAuthorId: true,
                includeAuthorSocial: true,
                authorTable: authors
            })
        )
        .from(recipes)
        .leftJoin(authors, eq(authors.id, recipes.authorId))
        .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
        .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
        // Avoid generating a query with empty parameters which can surface as
        // "params: ,,1" in neon/drizzle errors when the route param is missing.
        .where(isUuid ? or(eq(recipes.slug, v), eq(recipes.uuid, v)) : eq(recipes.slug, v))
        .limit(1);

    if (rows.length === 0) return null;
    const base = normalizeRecipeRow(rows[0]);

    const recipeId = base.id;

    const [comparisonRows, sampleRows] = await Promise.all([
        db
            .select({
                label: recipeComparisonImages.label,
                image: {
                    id: images.id,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens
                }
            })
            .from(recipeComparisonImages)
            .leftJoin(images, eq(images.id, recipeComparisonImages.imageId))
            .where(and(eq(recipeComparisonImages.recipeId, recipeId), eq(images.copyright, true))),

        db
            .select({
                image: {
                    id: images.id,
                    copyright: images.copyright,
                    preparedObjectKey: images.preparedObjectKey,
                    smallUrl: images.smallUrl,
                    fullSizeUrl: images.fullSizeUrl,
                    dimensions: images.dimensions,
                    camera: images.camera,
                    lens: images.lens,
                    validExif: images.validExif
                },
                isPrimary: recipeSampleImages.isPrimary,
                author: {
                    id: authors.id,
                    uuid: authors.uuid,
                    name: authors.name,
                    instagramLink: authors.instagramLink,
                    flickrLink: authors.flickrLink,
                    website: authors.website,
                    kofiLink: authors.kofiLink
                }
            })
            .from(recipeSampleImages)
            .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
            .leftJoin(authors, eq(authors.id, recipeSampleImages.authorId))
            .where(and(eq(recipeSampleImages.recipeId, recipeId), eq(images.copyright, true)))
            .orderBy(asc(recipeSampleImages.imageId))
    ]);

    const comparisonImages = (comparisonRows ?? [])
        .map((r) => (r.image?.id && r.image.copyright !== false ? { ...hydrateRecipeImageRecord(r.image), label: r.label } : null))
        .filter(Boolean);
    const sampleImages = (sampleRows ?? [])
        .map((r) => {
            if (!r?.image?.id || r.image.copyright === false) return null;
            return {
                ...hydrateRecipeImageRecord(r.image),
                isPrimary: r.isPrimary,
                sampleAuthor: r.author ?? null
            };
        })
        .filter(Boolean);
    const savedRecipeIds = await getSavedRecipeIdsForUser({ userId, recipeIds: [recipeId] });

    return {
        ...base,
        viewerIsLoggedIn: userId != null,
        isSaved: savedRecipeIds.has(recipeId),
        comparisonImages,
        sampleImages
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
    const ogImageUrl = primaryImage?.assetUrls?.original ?? null;

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

async function getAuthedAuthorIds(userId = null) {
    if (userId == null) return [];

    const rows = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, userId));

    return rows.map((row) => row.id);
}

async function getRelatedWhiteBalanceRecipes(recipeId, whiteBalance, recipeType = null) {
    if (!Number.isFinite(Number(recipeId)) || whiteBalance?.key == null) return [];

    const offsetFilters = [
        sql`coalesce(${recipes.whiteBalanceAmberOffset}, 0) = ${whiteBalance.amberOffset}`,
        sql`coalesce(${recipes.whiteBalanceGreenOffset}, 0) = ${whiteBalance.greenOffset}`
    ];
    const baseFilters = [
        ne(recipes.id, recipeId),
        ...(recipeType ? [eq(recipes.type, recipeType)] : [])
    ];

    let whereClause = null;

    if (whiteBalance.type === 'temperature') {
        whereClause = and(
            ...baseFilters,
            eq(recipes.whiteBalanceTemperature, whiteBalance.temperature),
            ...offsetFilters
        );
    } else if (whiteBalance.type === 'auto') {
        whereClause = and(
            ...baseFilters,
            sql`${recipes.whiteBalanceTemperature} is null`,
            ilike(recipes.whiteBalance2, 'auto%'),
            ...offsetFilters
        );
    } else if (whiteBalance.type === 'preset') {
        whereClause = and(
            ...baseFilters,
            sql`${recipes.whiteBalanceTemperature} is null`,
            eq(recipes.whiteBalance2, whiteBalance.label),
            ...offsetFilters
        );
    }

    if (whereClause == null) return [];

    return db
        .select({
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,
            recipeName: recipes.recipeName,
            authorName: recipes.authorName
        })
        .from(recipes)
        .where(whereClause)
        .orderBy(asc(recipes.recipeName), asc(recipes.authorName))
        .limit(8);
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
    if (isUuidLike(id) && recipe.uuid === id && recipe.slug && recipe.slug !== id) {
        permanentRedirect(getRecipePath(recipe));
    }
    const whiteBalance = getEquivalentWhiteBalance(recipe);
    const relatedWhiteBalanceRecipes = await getRelatedWhiteBalanceRecipes(recipe.id, whiteBalance, recipe.type);

    const authedAuthorIds = await getAuthedAuthorIds(userId);
    const isOwner = authedAuthorIds.includes(recipe.authorId);
    const saveCount = isOwner ? await getSaveCountForRecipe(recipe.id) : null;

    return (
        <div className="flex w-full flex-col gap-8 pb-10 pt-2">
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
