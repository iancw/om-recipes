import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Step, Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'Enter a Recipe by Hand on the OM-3',
    description:
        'Type a color or monochrome recipe straight into the OM-3 using the Creative Dial and Super Control Panel — no computer required.'
};

// Photos of the OM-3 screens would help several of these steps. Add
// <StepImage> calls (from ../_components/guide-primitives) once the images
// exist under /public/images/how-to/om-3-*.png.

export default function Om3ProfilesGuide() {
    return (
        <GuideLayout
            current="om-3-profiles"
            title="Enter a recipe by hand on the OM-3"
            intro="If you don't have a computer handy, you can build any recipe on this site directly on the OM-3 using the Creative Dial. It takes a few minutes per recipe, but nothing needs to be plugged in."
        >
            <Callout>
                Menu and screen names below come from the OM-3 manual and OM System user
                forums. OM System occasionally renames items in firmware updates, so treat the
                exact wording as a guide and confirm against what you see on your camera.
            </Callout>

            <Card>
                <CardHeader>
                    <CardTitle>When to use this</CardTitle>
                    <CardDescription>Versus the OM Workspace workflows.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                        The{' '}
                        <a href="/how-to/camera-from-jpg" className="text-primary underline-offset-4 hover:underline">
                            JPG workflow
                        </a>{' '}
                        is faster and more accurate when you have a computer and a USB cable —
                        it copies every wheel value for you. Enter recipes by hand when you&rsquo;re
                        travelling, want to tweak a recipe in the field, or just prefer to keep
                        everything on the camera.
                    </p>
                    <p>
                        New to what these settings mean? Read{' '}
                        <a href="/how-to/how-profiles-work" className="text-primary underline-offset-4 hover:underline">
                            how color profiles &amp; recipes work
                        </a>{' '}
                        first.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>1. Read the recipe values off this site</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}><p>Open the recipe you want on this site.</p></Step>
                    <Step number={2}>
                        <p>
                            Note whether it is a <strong>Color</strong> or <strong>Monochrome</strong>{' '}
                            recipe, and write down every value: the twelve colour-wheel positions
                            (hue shift and saturation for each), the highlight / shadow curve,
                            contrast, sharpness, gradation, and white balance (preset or Kelvin
                            plus any amber–blue / green–magenta shift).
                        </p>
                    </Step>
                    <Step number={3}>
                        <p>
                            For a monochrome recipe also note the colour-filter effect, toning,
                            and film-grain settings.
                        </p>
                    </Step>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>2. Open the profile editor on the camera</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}>
                        <p>
                            Set the mode dial to <strong>P</strong>, <strong>A</strong>,{' '}
                            <strong>S</strong> or <strong>M</strong> — not a Custom Mode
                            (C1&ndash;C5) slot. Profiles can only be edited from the base modes;
                            a Custom Mode replays a frozen copy of the settings.
                        </p>
                    </Step>
                    <Step number={2}>
                        <p>
                            Turn the front <strong>Creative Dial</strong> to{' '}
                            <strong>COLOR</strong> for a colour recipe, or <strong>MONO</strong>{' '}
                            for a monochrome one.
                        </p>
                    </Step>
                    <Step number={3}>
                        <p>
                            The camera shows the profile picker. Choose a slot to write into —{' '}
                            <strong>Color&nbsp;1&ndash;4</strong> or{' '}
                            <strong>Mono&nbsp;1&ndash;4</strong>. Picking a slot you don&rsquo;t
                            mind overwriting keeps the four factory profiles intact.
                        </p>
                    </Step>
                    <Step number={4}>
                        <p>
                            Press <strong>OK</strong> (or the menu / info button, depending on
                            firmware) to open the detailed edit screen for that slot.
                        </p>
                    </Step>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>3. Enter the colour-wheel values</CardTitle>
                    <CardDescription>Colour recipes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}>
                        <p>
                            The wheel has twelve points around it. Rotate to a colour point,
                            then set its <strong>saturation</strong> in or out, and its{' '}
                            <strong>hue</strong> shift around the wheel, to match the recipe.
                        </p>
                    </Step>
                    <Step number={2}>
                        <p>
                            Work around all twelve points. The Super Control Panel and the front
                            / rear dials adjust the highlighted value; the touchscreen works too.
                        </p>
                    </Step>
                    <Step number={3}>
                        <p>
                            If the recipe was built with the <strong>Color Creator (CRT)</strong>{' '}
                            rather than the full wheel, turn the Creative Dial to{' '}
                            <strong>CRT</strong> instead and set the single hue and saturation
                            pair it specifies.
                        </p>
                    </Step>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>4. Enter the remaining settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}>
                        <p>
                            Set <strong>Highlight &amp; Shadow Control</strong> (the tone curve) —
                            highlights, mid-tones and shadows — to the recipe&rsquo;s values.
                        </p>
                    </Step>
                    <Step number={2}>
                        <p>
                            Set <strong>Contrast</strong>, <strong>Sharpness</strong> and{' '}
                            <strong>Gradation</strong> from the Super Control Panel.
                        </p>
                    </Step>
                    <Step number={3}>
                        <p>
                            For a monochrome recipe, set the <strong>colour filter effect</strong>,{' '}
                            <strong>toning</strong> and <strong>film grain</strong>.
                        </p>
                    </Step>
                    <Step number={4}>
                        <p>
                            Set <strong>White Balance</strong> separately — choose the preset or
                            Kelvin value and dial in any amber&ndash;blue / green&ndash;magenta
                            shift. White balance is not part of the colour profile itself.
                        </p>
                    </Step>
                    <Step number={5}><p>Confirm to save the profile into its slot.</p></Step>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>5. Save the recipe to a Custom Mode</CardTitle>
                    <CardDescription>So it survives and you can switch to it quickly.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}>
                        <p>
                            With the profile selected and the camera set the way you want it,
                            open the menu and find <strong>Save Settings to Custom Mode</strong>{' '}
                            (under the Custom Mode / <em>C</em> settings).
                        </p>
                    </Step>
                    <Step number={2}>
                        <p>
                            Choose a slot, <strong>C1&ndash;C5</strong>, and confirm. That slot
                            now recalls the whole camera state, including this profile.
                        </p>
                    </Step>
                    <Callout>
                        Each Custom Mode stores its own copy of all four Color and four Mono
                        profiles, so you can keep well over twenty recipes on the camera by
                        spreading them across C1&ndash;C5.
                    </Callout>
                </CardContent>
            </Card>

            <Callout>
                <strong>What you can&rsquo;t enter by hand:</strong> anything the camera has no
                control for. If a recipe relies on a setting your OM-3 doesn&rsquo;t expose,
                use the{' '}
                <a href="/how-to/camera-from-jpg" className="text-primary underline-offset-4 hover:underline">
                    JPG workflow
                </a>{' '}
                or apply it in{' '}
                <a href="/how-to/om-workspace" className="text-primary underline-offset-4 hover:underline">
                    OM Workspace
                </a>
                .
            </Callout>
        </GuideLayout>
    );
}
