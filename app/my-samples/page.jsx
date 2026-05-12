import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import MySamplesGrid from '../../components/MySamplesGrid.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { buttonVariants } from '../../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { db } from '../../db/index.ts';
import { authors, images, recipeSampleImages, recipes } from '../../db/schema.ts';
import { getSession } from '../../lib/auth.js';
import { hydrateRecipeImageRecord } from '../../lib/recipe-image-assets.js';
import { deleteMySampleImageAction } from './actions.js';

export const metadata = {
    title: 'Samples'
};

async function getSampleImagesUploadedByUserId({ userId, limit = 500 }) {
    const uploaderRows = await db
        .select({ id: authors.id })
        .from(authors)
        .where(eq(authors.userId, userId));

    if (uploaderRows.length === 0) return [];

    const uploaderAuthorIds = uploaderRows.map((row) => row.id);

    return db
        .select({
            recipeId: recipes.id,
            recipeUuid: recipes.uuid,
            recipeSlug: recipes.slug,
            recipeName: recipes.recipeName,
            recipeAuthorName: recipes.authorName,
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
        .from(recipeSampleImages)
        .innerJoin(recipes, eq(recipes.id, recipeSampleImages.recipeId))
        .leftJoin(images, eq(images.id, recipeSampleImages.imageId))
        .where(and(inArray(recipeSampleImages.authorId, uploaderAuthorIds), eq(images.copyright, true)))
        .orderBy(desc(images.createdAt))
        .limit(limit)
        .then((rows) =>
            rows.map((row) => ({
                ...row,
                image: hydrateRecipeImageRecord(row.image)
            })).filter((row) => row.image?.id && row.image.copyright !== false)
        );
}

export default async function Page() {
    const session = await getSession();
    const user = session?.user;

    if (!user) {
        return (
            <Card className="max-w-xl">
                <CardHeader>
                    <CardTitle>Samples</CardTitle>
                    <CardDescription>Welcome! Please log in to access your protected content.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Link href="/login?redirectTo=%2Fmy-samples" className={buttonVariants()}>
                        Log in
                    </Link>
                </CardContent>
            </Card>
        );
    }

    const uploadedSamples = await getSampleImagesUploadedByUserId({ userId: user.id });

    return (
        <div className="flex w-full flex-col gap-8 pb-10 pt-2">
            <Card className="overflow-hidden border-border/60 bg-card/80">
                <CardContent className="space-y-4 p-6 lg:p-8">
                    <Badge>Samples</Badge>
                    <div className="space-y-3">
                        <h1 className="max-w-3xl">Samples</h1>
                        <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                            Manage sample images you’ve uploaded across recipes, including your own and community matches.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {uploadedSamples.length === 0 ? (
                <Card className="max-w-2xl border-dashed bg-card/75">
                    <CardContent className="space-y-4 p-8">
                        <div className="space-y-2">
                            <h2 className="text-2xl font-semibold text-foreground">No samples yet</h2>
                            <p className="text-muted-foreground">
                                You haven’t uploaded any sample images yet.
                            </p>
                        </div>
                        <div>
                            <Link href="/upload" className={buttonVariants()}>
                                Upload your first sample
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <MySamplesGrid samples={uploadedSamples} deleteSampleAction={deleteMySampleImageAction} />
            )}
        </div>
    );
}
