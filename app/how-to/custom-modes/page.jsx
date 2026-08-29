import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'Using Custom Dial Modes for Recipes',
    description:
        'How the OM-3 custom modes (C1–C5) store color profiles and white balance, and ways to keep track of which recipe lives where.'
};

export default function CustomModesGuide() {
    return (
        <GuideLayout
            current="custom-modes"
            title="Using custom dial modes for recipes"
            intro="Because many recipes rely on white balance shifts, and because switching color profile slots on the camera is awkward, a lot of recipe enthusiasts save recipes into the custom modes instead."
        >
            <Card>
                <CardHeader>
                    <CardTitle>How modes, profiles, and white balance relate</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        Each of the five custom modes on the OM-3 (C1&ndash;C5) gets its own set of
                        four Color Profiles. The B/M/S/A/P modes all share one set of four Color
                        Profile slots — set Color Profile 1 in M mode and it&rsquo;s the same
                        profile in S or A, but a C1&ndash;C5 mode has its own.
                    </p>
                    <p>
                        White balance and WB offsets follow the same pattern: shared across
                        B/M/S/A/P, separate for each of C1&ndash;C5. White balance is tied to the
                        mode dial position, not to a Color Profile slot, so all four Color Profiles
                        within a mode share the same white balance.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Save Settings: Reset vs. Hold</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        Custom modes C1&ndash;C5 can be set to behave two ways when you power off or
                        switch modes:
                    </p>
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            <strong>Hold</strong> — any changes you make, such as edits to a color
                            profile, are saved automatically when you power off or switch modes.
                        </li>
                        <li>
                            <strong>Reset</strong> — changes are discarded unless you go into the
                            custom mode menu and perform an <strong>Assign: Set</strong>.
                        </li>
                    </ul>
                    <p>
                        Reset is nice when everything is configured and you don&rsquo;t want to
                        accidentally change something or forget to change it back. It&rsquo;s
                        frustrating, though, when you&rsquo;re trying to enter a color profile and
                        expect it to persist.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Keeping track of recipes across custom modes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        The OM-3 lets you name the custom modes (C1&ndash;C5), which helps. Individual
                        color profiles still can&rsquo;t be named, so it can be hard to remember
                        which profile is saved in which slot of which mode.
                    </p>
                    <p>
                        One approach is to keep Color Profile slots 1&ndash;4 consistent in theme
                        across modes. A pattern that works well mirrors the default profiles:
                    </p>
                    <ol className="list-decimal space-y-1 pl-6">
                        <li>Profile 1 — the normal day-to-day recipe (&ldquo;normal&rdquo;).</li>
                        <li>Profile 2 — a little more contrast and saturation (&ldquo;a little punch&rdquo;).</li>
                        <li>Profile 3 — heavy contrast and saturation (&ldquo;bold and punchy&rdquo;).</li>
                        <li>Profile 4 — reduced contrast and saturation (&ldquo;light and airy&rdquo;).</li>
                    </ol>
                    <p>
                        You can also use the{' '}
                        <a
                            href="/camera-settings"
                            className="text-primary underline-offset-4 hover:underline"
                        >
                            Camera Settings
                        </a>{' '}
                        page to record which profiles are loaded into which slots of which modes.
                        It also filters for recipes with compatible white balance. It relies on you
                        to keep it accurate, but it can be handy.
                    </p>
                    <p>
                        Low-tech options work too: write them in your camera notebook, or print a
                        cheat sheet and tape it to the bottom of the camera or behind the screen.
                    </p>
                </CardContent>
            </Card>

            <Callout>
                <strong>Heads up:</strong> if a custom mode is set to <strong>Reset</strong>,
                dialing in a new color profile won&rsquo;t stick until you run{' '}
                <strong>Assign: Set</strong> from the custom mode menu.
            </Callout>
        </GuideLayout>
    );
}
