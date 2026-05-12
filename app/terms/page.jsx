import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'components/ui/card';
import { buttonVariants } from 'components/ui/button';
import { Markdown } from 'components/markdown';

export const metadata = {
    title: 'Terms and Conditions',
    description: 'Terms and conditions for using OM Recipes and submitting content.'
};

async function loadTerms() {
    const filePath = path.join(process.cwd(), 'app/terms/terms.md');
    return fs.readFile(filePath, 'utf8');
}

export default async function TermsPage() {
    const content = await loadTerms();

    return (
        <div className="space-y-6">
            <Card className="max-w-4xl">
                <CardHeader>
                    <CardTitle>Terms and Conditions</CardTitle>
                    <CardDescription>
                        The terms below govern your use of OM Recipes and any content you submit to the Site.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-sm leading-7 text-muted-foreground">
                    <Markdown content={content} className="prose-sm" />
                    <div className="pt-6">
                        <Link href="/about" className={buttonVariants()}>
                            Open contact form
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
