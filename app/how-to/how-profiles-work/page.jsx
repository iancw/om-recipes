import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'How Color Profiles & Recipes Work',
    description:
        'A plain-language tour of what a recipe actually is — the color wheel, tone curve, white balance, monochrome settings, and how the camera stores profiles.'
};

function Term({ children }) {
    return <dt className="font-medium text-foreground">{children}</dt>;
}

function Def({ children }) {
    return <dd className="mb-4 text-muted-foreground leading-relaxed">{children}</dd>;
}

export default function HowProfilesWorkGuide() {
    return (
        <GuideLayout
            current="how-profiles-work"
            title="How color profiles & recipes work"
            intro="Every recipe on this site is a named bundle of picture settings your camera applies as you shoot. Here's what each part does."
        >
            <Card>
                <CardHeader>
                    <CardTitle>What a recipe is</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        A recipe is one <strong>Color Profile</strong> or{' '}
                        <strong>Monochrome Profile</strong> plus the supporting settings that go
                        with it — tone, white balance, and a few others. Load it into the camera
                        and every JPEG comes out with that look, straight out of camera, no
                        editing.
                    </p>
                    <p>
                        The camera keeps profiles in numbered slots and can bundle a whole
                        camera setup — including a profile — into a Custom Mode you switch to
                        like a film stock.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>The color wheel</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        The wheel is the heart of a color recipe. It splits the spectrum into
                        twelve hue bands — yellow, orange, orange-red, red, magenta, violet,
                        blue, blue-cyan, cyan, green-cyan, green, and yellow-green. For each band
                        you can change two things:
                    </p>
                    <dl>
                        <Term>Saturation</Term>
                        <Def>
                            How intense that band of color is. Pull red&rsquo;s saturation down and
                            red objects go muted; push it up and they get vivid. This is what
                            gives many recipes their character — for example dropping greens and
                            lifting warm tones for an autumnal look.
                        </Def>
                        <Term>Hue shift</Term>
                        <Def>
                            Nudges that band around the wheel toward its neighbours — pushing
                            cyan toward blue, or yellow toward green — so skies, foliage and
                            skin tones lean a particular direction.
                        </Def>
                    </dl>
                    <p>
                        On this site the wheel is drawn as a ring; the further a band&rsquo;s marker
                        sits from the centre, the more saturated it is.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Tone &amp; contrast</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        <strong>Highlight &amp; Shadow Control</strong> is a three-handle tone
                        curve: separate adjustments for highlights, mid-tones and shadows. Lower
                        the highlights and raise the shadows for a flatter, filmic roll-off;
                        do the opposite for punch.
                    </p>
                    <p>
                        <strong>Contrast</strong> and <strong>Sharpness</strong> are overall
                        sliders on top of that. <strong>Gradation</strong> is the camera&rsquo;s
                        auto-tone mode (Normal, or one of the auto/high-key/low-key options).
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>White balance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        White balance sets the overall warmth of the image — a preset (Daylight,
                        Shade, and so on) or a specific Kelvin value — plus a two-axis{' '}
                        <strong>shift</strong>: amber&ndash;blue and green&ndash;magenta. A recipe
                        often leans on a deliberate white-balance choice for its mood.
                    </p>
                    <Callout>
                        White balance is stored <strong>separately</strong> from the color
                        profile. The{' '}
                        <a href="/how-to/camera-from-jpg" className="text-primary underline-offset-4 hover:underline">
                            JPG workflow
                        </a>{' '}
                        does not carry it across, so you always set white balance by hand after
                        loading a recipe that way.
                    </Callout>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Monochrome recipes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        Monochrome profiles live in their own slots and swap the color wheel for
                        black-and-white controls:
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>
                            <strong>Color filter effect</strong> — simulates a coloured lens
                            filter, lightening its own colour and darkening the opposite (a
                            yellow or red filter darkens blue skies).
                        </li>
                        <li>
                            <strong>Toning</strong> — a tint across the image, such as sepia or
                            a cool blue, at an adjustable strength.
                        </li>
                        <li>
                            <strong>Film grain</strong> — adds low, medium or high grain texture.
                        </li>
                        <li>
                            <strong>Shading / vignette</strong> — darkens the frame edges.
                        </li>
                    </ul>
                    <p>The tone curve, contrast, sharpness and white balance work the same as for color.</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Where the camera keeps them</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <dl>
                        <Term>Color / Mono profile slots</Term>
                        <Def>
                            Four colour (Color&nbsp;1&ndash;4) and four monochrome (Mono&nbsp;1&ndash;4)
                            editable slots, reached with the Creative Dial. This is where the
                            actual recipe values live.
                        </Def>
                        <Term>Custom Modes (C1&ndash;C5)</Term>
                        <Def>
                            Snapshots of the entire camera setup — exposure settings, AF options,
                            and the current profile — that you recall from the mode dial. Storing
                            a recipe to a Custom Mode is what lets you flip between looks quickly.
                            Each Custom Mode carries its own copy of all eight profile slots.
                        </Def>
                        <Term>Picture Mode</Term>
                        <Def>
                            The older, simpler list (Natural, Vivid, Portrait, Mono, and so on).
                            Color and Monochrome Profiles are the more capable system that
                            replaced it for recipe work.
                        </Def>
                    </dl>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Getting a recipe onto your camera</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-muted-foreground leading-relaxed">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>
                            <a href="/how-to/camera-from-jpg" className="text-primary underline-offset-4 hover:underline">
                                From a JPG
                            </a>{' '}
                            — fastest; OM Workspace copies every value for you over USB.
                        </li>
                        <li>
                            <a href="/how-to/om-3-profiles" className="text-primary underline-offset-4 hover:underline">
                                By hand on the OM-3
                            </a>{' '}
                            — no computer needed; you type the values in.
                        </li>
                        <li>
                            <a href="/how-to/om-workspace" className="text-primary underline-offset-4 hover:underline">
                                In OM Workspace (.OES)
                            </a>{' '}
                            — applies the look to raw files on your computer rather than the
                            camera.
                        </li>
                    </ul>
                </CardContent>
            </Card>
        </GuideLayout>
    );
}
