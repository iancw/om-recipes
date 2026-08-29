import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'How OM System Color Recipes Work',
    description:
        'Background on the OM System creative dial, color profiles and monochrome profiles, OM Workspace, and how this site fits in.'
};

export default function HowRecipesWorkGuide() {
    return (
        <GuideLayout
            current="how-recipes-work"
            title="How OM System color recipes work"
            intro="A few Olympus / OM System models — the Pen-F, E-P7, and OM-3 — have a creative dial that lets you customize the look of your camera JPGs. This page explains what that dial does and how the rest of the site is built around it."
        >
            <Card>
                <CardHeader>
                    <CardTitle>The creative dial</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-muted-foreground leading-relaxed">
                    <p>
                        With the creative dial turned to <strong>COLOR</strong>, these cameras let
                        you set the saturation of 12 colors independently. That gives you a fair
                        amount of control over the styles you can get straight from the camera,
                        without post-processing raw files.
                    </p>
                    <p>
                        The <strong>MONO</strong> position works the same way for monochrome
                        profiles. Instead of per-color saturation you choose color filters and
                        their strength, add grain, and control the general color cast (sepia,
                        blue, and so on). Most of the monochrome options are also available on
                        camera models without a creative dial.
                    </p>
                    <p>
                        The dial also has <strong>ART</strong> and <strong>CRT</strong> positions.
                        Those are heavier-handed and less commonly used, and this site does not
                        currently support recipes that rely on them.
                    </p>
                    <p>
                        OM System&rsquo;s customization is more limited than some other camera
                        systems or computer-based editing: there is no per-color hue or luminance
                        adjustment, only saturation. To work around this, many recipe authors use
                        white balance shifts — particularly amber and magenta — to nudge hues.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Why shoot recipes at all?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>The point is a finished-looking image straight out of the camera. A few reasons that appeals to people:</p>
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            It&rsquo;s easy and fun to share right away — camera to phone to
                            shared, done. Not for the masterpieces, but for a lot of day-to-day
                            photography.
                        </li>
                        <li>
                            It moves you closer to visualizing the final image while you&rsquo;re
                            still shooting, the way Ansel Adams did.
                        </li>
                        <li>It&rsquo;s a low-pressure way to learn about processing techniques and color theory.</li>
                        <li>
                            You can still shoot raw alongside JPG and lose almost nothing — just a
                            little drive space.
                        </li>
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OM Workspace</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        Like most camera makers, OM System supplies its own raw processing
                        software. It doesn&rsquo;t offer masking like Lightroom, but it covers the
                        standard basic adjustments.
                    </p>
                    <p>
                        OM Workspace has a rough analog to Lightroom presets called{' '}
                        <strong>batch processing files</strong>, with the extension{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-sm font-mono">.oes</code>.
                        Every recipe here can be represented as an OES file, and the site lets you
                        download one so you can try a recipe on your own images. See the{' '}
                        <a
                            href="/how-to/om-workspace"
                            className="text-primary underline-offset-4 hover:underline"
                        >
                            OM Workspace guide
                        </a>
                        .
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>How recipe data is shared</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        The camera writes recipe settings into the extended EXIF data of the JPGs
                        it produces. This site reads those fields to parse a recipe out of a
                        camera JPG, so creating a recipe is as simple as uploading a JPG with
                        novel settings and giving it a name.
                    </p>
                    <p>
                        To keep things focused on sharing recipes for in-camera use, the site only
                        accepts images that come directly from the camera with no further editing.
                        Every sample image on the site came from a creative-dial camera without
                        computer-based processing.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Getting recipes into your camera</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>There are currently two ways:</p>
                    <ol className="list-decimal space-y-2 pl-6">
                        <li>
                            Enter the settings by hand using the camera controls — see the{' '}
                            <a
                                href="/how-to/manual-entry"
                                className="text-primary underline-offset-4 hover:underline"
                            >
                                manual entry guide
                            </a>
                            .
                        </li>
                        <li>
                            Use OM Workspace with the camera connected over USB to load a recipe
                            stored in a straight-out-of-camera JPG into one of your Color Profile
                            slots — see the{' '}
                            <a
                                href="/how-to/camera-from-jpg"
                                className="text-primary underline-offset-4 hover:underline"
                            >
                                JPG workflow
                            </a>
                            .
                        </li>
                    </ol>
                    <p>
                        It would be far more convenient if this could be done wirelessly from a
                        phone. Until then, manual entry is often the best and sometimes the only
                        option, so the site presents recipe information in a way that makes it
                        quick to enter by hand.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>How this site relates to OM System</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        OM System publishes a{' '}
                        <a
                            href="https://explore.omsystem.com/us/en/creative-recipes"
                            className="text-primary underline-offset-4 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Creative Recipes page
                        </a>{' '}
                        with recipes from various creators. It only offers a download link to the
                        original JPG, though — there is no way to see the details of a recipe
                        without OM Workspace and a computer. Its &ldquo;share your recipe&rdquo;
                        button also doesn&rsquo;t always result in a recipe being featured.
                    </p>
                    <p>
                        This site exists to ease those pain points. Anyone can share a recipe here
                        as long as it follows the guidelines and comes from a straight-out-of-camera
                        JPG, and every recipe&rsquo;s details are laid out visually to help with
                        manual entry and general understanding.
                    </p>
                </CardContent>
            </Card>

            <Callout>
                <strong>Tip:</strong> Not sure a recipe will match your camera&rsquo;s white
                balance setup? The{' '}
                <a
                    href="/camera-settings"
                    className="text-primary underline-offset-4 hover:underline"
                >
                    Camera Settings
                </a>{' '}
                page can track which profiles you&rsquo;ve loaded into which slots and filter for
                compatible white balance.
            </Callout>
        </GuideLayout>
    );
}
