import { after } from 'next/server';
import { eq } from 'drizzle-orm';
import { uploadDisabled } from 'utils';
import { Alert } from 'components/alert';
import { Markdown } from 'components/markdown';
import RecipeUpload from './RecipeUpload';
import { db } from '../../db/index.ts';
import { authors, users } from '../../db/schema.ts';
import { defaultDisplayNameFromEmail, getSession } from '../../lib/auth.js';
import { warmImageResizeFunction } from '../../lib/oci/functionsInvoke.js';
import LoginButton from 'components/LoginButton';
import { Badge } from 'components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';

export const metadata = {
    title: 'Upload'
};

const explainer = `
OM System recipes are embedded in the JPG files produced by a camera.
Creating a recipe on this site is as simple as uploading a JPG produced by the camera!
`;

const explainerNote = `Only JPGs produced by Olympus or OM System cameras with compatible color or monochrome profiles (OM-3, Pen-F, or E-P7) will work reliably. JPGs produced by OM Workspace are allowed, but recipes stored in those files may not be accurate and should be carefully checked before you publish them.`;

const uploadDisabledText = `
Sorry! Uploads are disabled right now.
`;

export default async function Page() {
    const session = await getSession();
    const user = session?.user;

    if (user) {
        after(() => warmImageResizeFunction().catch(() => {}));
    }

    let initialAuthor = '';
    if (user) {
        const [row] = await db
            .select({ email: users.email, authorName: authors.name })
            .from(users)
            .leftJoin(authors, eq(authors.userId, users.id))
            .where(eq(users.id, user.id))
            .limit(1);
        initialAuthor = row?.authorName ?? defaultDisplayNameFromEmail(row?.email) ?? '';
    }

    return (
        <div className="flex w-full flex-col gap-8 pb-10 pt-2">
            {uploadDisabled ? (
                <Alert className="mb-6">
                    <Markdown content={uploadDisabledText} />
                </Alert>
            ) : null}
            <Card className="overflow-hidden border-border/60 bg-card/80">
                <CardContent className="space-y-4 p-6 lg:p-8">
                    <Badge>Create</Badge>
                    <div className="space-y-3">
                        <h1 className="max-w-3xl">Create Recipes</h1>
                        <Markdown content={explainer} className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg" />
                        <p className="max-w-2xl text-xs italic leading-5 text-muted-foreground/70 sm:text-sm">
                            {explainerNote}
                        </p>
                    </div>
                </CardContent>
            </Card>
            {!uploadDisabled &&
                <>
                    {user ? (
                        <RecipeUpload initialAuthor={initialAuthor} />
                    ) : (
                        <Card className="max-w-xl border-border/60 bg-background/55">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Log in to upload</CardTitle>
                                <CardDescription>
                                    Sign in to upload a sample image and manage your recipe over time.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <LoginButton redirectTo="/upload" />
                            </CardContent>
                        </Card>
                    )}
                </>
            }
        </div>
    );
}
