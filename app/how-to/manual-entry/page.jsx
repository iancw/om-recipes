import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Step, Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'Enter a Color Recipe on the Camera by Hand',
    description:
        'Dial an OM System color profile into the camera manually using the creative dial and the on-camera controls.'
};

export default function ManualEntryGuide() {
    return (
        <GuideLayout
            current="manual-entry"
            title="Enter a recipe on the camera by hand"
            intro="Dialing in a color profile is fairly straightforward once you know where to look. This walkthrough follows the OM-3; other creative-dial cameras are similar."
        >
            <Card>
                <CardHeader>
                    <CardTitle>Manually entering a color profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}>
                        <p>
                            Turn the <strong>creative dial</strong> to <strong>COLOR</strong>.
                        </p>
                    </Step>
                    <Step number={2}>
                        <p>
                            Choose a <strong>Color Profile</strong> slot (1&ndash;4).
                        </p>
                        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
                            <li>This is a memory slot where your recipe settings are saved.</li>
                            <li>
                                You get four separate color profiles per mode dial position (C1&ndash;C5
                                and B/M/S/A/P), but all four share the custom white balance assigned to
                                that mode dial position.
                            </li>
                            <li>
                                There is no button or dial shortcut to switch profile slots. Bring up
                                the super control panel with the <strong>OK</strong> button, navigate to
                                the Color Profile slot, and use the front or rear dial to switch.
                            </li>
                        </ul>
                    </Step>
                    <Step number={3}>
                        <p>
                            <strong>Color</strong> (per-color saturation).
                        </p>
                        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
                            <li>
                                Turn the <strong>front dial</strong> to move around the color circle —
                                first all colors together, then each of the 12 individual channels.
                            </li>
                            <li>
                                Use the <strong>rear dial</strong> to set the saturation value from
                                &minus;5 to +5.
                            </li>
                            <li>
                                Setting saturation for the 12 colors individually is the defining
                                feature of the creative-dial cameras (Pen-F, E-P7, OM-3).
                            </li>
                        </ul>
                    </Step>
                    <Step number={4}>
                        <p>
                            <strong>Tone curve.</strong>
                        </p>
                        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
                            <li>The front dial controls highlights.</li>
                            <li>The rear dial controls shadows.</li>
                            <li>
                                The <strong>INFO</strong> button toggles the dials between the
                                midtone control and the shadow / highlight controls.
                            </li>
                        </ul>
                    </Step>
                    <Step number={5}>
                        <p>
                            <strong>Shading effect</strong> (vignette). Negative values darken the
                            corners, more so the lower you go; positive values lighten them.
                        </p>
                    </Step>
                    <Step number={6}>
                        <p>
                            <strong>Sharpness</strong>, from &minus;2 to +2. Less sharpness can be
                            flattering for portraits or for an older look.
                        </p>
                    </Step>
                    <Step number={7}>
                        <p>
                            <strong>Contrast</strong>, from &minus;2 to +2. Similar to raising
                            highlights and lowering shadows on the tone curve.
                        </p>
                    </Step>
                </CardContent>
            </Card>

            <Callout>
                The 12 color-channel saturation settings are the trickiest part. Each recipe page
                on this site presents them laid out to match the camera&rsquo;s input so you can
                follow along channel by channel.
            </Callout>
        </GuideLayout>
    );
}
