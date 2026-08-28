import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from 'components/ui/card';
import { Badge } from 'components/ui/badge';
import GuideSubNav from './_components/GuideSubNav';
import { GUIDE_PAGES } from 'lib/guide-pages.js';

export const metadata = {
    title: 'Guides',
    description:
        'Step-by-step guides for loading OM System color recipes into OM Workspace and your camera, and how the settings work.'
};

export default function GuidesHubPage() {
    return (
        <div className="mx-auto w-full max-w-4xl px-8 py-10 space-y-10">
            <div className="space-y-4">
                <Badge variant="outline">Guides</Badge>
                <h1>Guides</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    How to get a recipe onto your camera or into OM Workspace — and what the
                    settings behind a recipe actually do.
                </p>
            </div>

            <GuideSubNav current="hub" />

            <div className="grid gap-4 sm:grid-cols-2">
                {GUIDE_PAGES.map((page) => (
                    <Link key={page.href} href={page.href} className="no-underline">
                        <Card className="h-full transition-colors hover:bg-accent/40">
                            <CardHeader>
                                <CardTitle className="text-base">{page.label}</CardTitle>
                                <CardDescription>{page.description}</CardDescription>
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}
