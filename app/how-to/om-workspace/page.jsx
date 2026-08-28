import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Step, StepImage, Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'Using OM Workspace Batch Files (.OES)',
    description:
        'Download a recipe as an OM Workspace batch processing (.OES) file and apply it to your raw photos.'
};

export default function OmWorkspaceGuide() {
    return (
        <GuideLayout
            current="om-workspace"
            title="Using OM Workspace batch processing files (.OES)"
            intro="OES files are OM Workspace presets that apply a saved set of image adjustments — including Color Profile / Color Recipe or Monochrome Creator settings — to any raw (.ORF) file."
        >
            <p className="text-muted-foreground leading-relaxed">
                An OES file can&rsquo;t be loaded directly into the camera. To get a recipe onto
                the camera itself, see the{' '}
                <a
                    href="/how-to/camera-from-jpg"
                    className="text-primary underline-offset-4 hover:underline"
                >
                    JPG workflow
                </a>{' '}
                or{' '}
                <a
                    href="/how-to/om-3-profiles"
                    className="text-primary underline-offset-4 hover:underline"
                >
                    manual entry on the OM-3
                </a>
                .
            </p>

            <Card>
                <CardHeader>
                    <CardTitle>Download an OES file</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}><p>Open a recipe on this site.</p></Step>
                    <Step number={2}><p>Find the <strong>OM Workspace Batch Processing File</strong> link and click it.</p></Step>
                    <Step number={3}><p>Save the <code className="rounded bg-muted px-1 py-0.5 text-sm font-mono">.OES</code> file somewhere easy to find (e.g. Downloads).</p></Step>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Load the OES file in OM Workspace</CardTitle>
                    <CardDescription>Menu names may vary slightly by version.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Step number={1}><p>Open <strong>OM Workspace</strong>.</p></Step>
                    <Step number={2}><p>Select a raw photo (.ORF) or group of photos.</p></Step>
                    <Step number={3}>
                        <p>
                            Click the <strong>floppy disk icon</strong> in the lower right — it
                            shows <em>Save Batch Processing File</em> and{' '}
                            <em>Load Batch Processing File</em>.
                        </p>
                        <StepImage
                            src="/images/how-to/om-wkspc-oes-open.png"
                            alt="OM Workspace: opening the preset/batch processing panel"
                            caption="OM Workspace: open the preset / batch processing area."
                        />
                    </Step>
                    <Step number={4}>
                        <p>Choose <strong>Load Batch Processing File</strong> and select the downloaded OES file.</p>
                        <StepImage
                            src="/images/how-to/om-wkspc-oes-load.png"
                            alt="OM Workspace: loading an .OES preset file"
                            caption="OM Workspace: load / import the downloaded .OES file."
                        />
                    </Step>
                    <Step number={5}><p>The settings are now applied and visible in the Edit pane.</p></Step>
                </CardContent>
            </Card>

            <Callout>
                <strong>Tip — batch apply:</strong> Select multiple photos before loading the
                preset to apply the same look across all of them in one go.
            </Callout>
        </GuideLayout>
    );
}
