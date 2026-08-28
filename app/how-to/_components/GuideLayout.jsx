import { Badge } from 'components/ui/badge';
import GuideSubNav from './GuideSubNav';

// Page shell for an individual /how-to guide: constrained width, a hero with a
// "Guide" badge / title / intro, the shared sub-nav, then the page body.
export default function GuideLayout({ current, title, intro, children }) {
    return (
        <div className="mx-auto w-full max-w-4xl px-8 py-10 space-y-10">
            <div className="space-y-4">
                <Badge variant="outline">Guide</Badge>
                <h1>{title}</h1>
                {intro && (
                    <p className="text-lg text-muted-foreground leading-relaxed">{intro}</p>
                )}
            </div>

            <GuideSubNav current={current} />

            <div className="space-y-10">{children}</div>
        </div>
    );
}
