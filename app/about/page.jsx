import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'components/ui/card';
import { Badge } from 'components/ui/badge';
import { ContactForm } from './ContactForm';

export const metadata = {
    title: 'About',
    description: 'Learn about OM Recipes — a community site for discovering and sharing color and monochrome recipes for OM System and Olympus cameras.'
};

export default function AboutPage() {
    return (
        <div className="mx-auto w-full max-w-3xl px-8 py-10 space-y-8">
            {/* Hero */}
            <div className="space-y-4">
                <Badge variant="outline">Community Project</Badge>
                <h1>About OM Recipes</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    A website built for fun to help photographers understand and share color and monochrome
                    recipes for OM System cameras.
                </p>
            </div>

            {/* Community */}
            <Card>
                <CardHeader>
                    <CardTitle>The Community</CardTitle>
                    <CardDescription>
                        This site wouldn&rsquo;t exist without the photographers who put in the
                        work to craft and share their recipes.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground leading-relaxed">
                        A huge thanks to all the recipe authors who have worked hard to craft and
                        share their recipes with the community. I hope this site makes that process
                        more enjoyable and helps more people discover your work.
                    </p>
                </CardContent>
            </Card>

            {/* Contact + Support */}
            <div className="grid sm:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Get in Touch</CardTitle>
                        <CardDescription>
                            Want to claim a recipe or have other questions? Reach out any time.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ContactForm />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Support the Site</CardTitle>
                        <CardDescription>
                            OM Recipes is free and independent. If you enjoy it, a coffee is
                            always appreciated.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <a
                            href="https://ko-fi.com/ianwill"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                            Donate ☕ on Ko-fi
                        </a>
                    </CardContent>
                </Card>
            </div>

            <p className="text-xs text-muted-foreground">
                This is not an official OM System website. It is an independent, community-driven
                project.
            </p>
        </div>
    );
}
