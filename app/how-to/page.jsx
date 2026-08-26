import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'components/ui/card';
import { Badge } from 'components/ui/badge';

export const metadata = {
    title: 'How to Load Color Recipes',
    description: 'Step-by-step guides for loading OM System color recipes into OM Workspace (.OES files) and directly into your camera via JPG.'
};

function Step({ number, children }) {
    return (
        <div className="flex gap-4">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {number}
            </div>
            <div className="flex-1 space-y-3 pb-2">{children}</div>
        </div>
    );
}

function StepImage({ src, alt, caption }) {
    return (
        <figure>
            <Image
                src={src}
                alt={alt}
                width={1280}
                height={800}
                sizes="(min-width: 1024px) 800px, 100vw"
                className="w-full max-w-2xl rounded-lg border border-border"
                style={{ height: 'auto' }}
            />
            {caption && (
                <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>
            )}
        </figure>
    );
}

function Callout({ children }) {
    return (
        <div className="rounded-r-lg border-l-4 border-primary/50 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {children}
        </div>
    );
}

export default function HowToPage() {
    return (
        <div className="mx-auto w-full max-w-4xl px-8 py-10 space-y-10">
            {/* Hero */}
            <div className="space-y-4">
                <Badge variant="outline">Guides</Badge>
                <h1>How-to</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    Step-by-step guides for loading recipes into OM Workspace and your camera.
                </p>
            </div>

            {/* TOC */}
            <div className="grid sm:grid-cols-2 gap-4">
                <a href="#oes">
                    <Card className="h-full transition-colors hover:bg-accent/40">
                        <CardHeader>
                            <CardTitle className="text-base">OM Workspace (.OES)</CardTitle>
                            <CardDescription>
                                Load a recipe via batch processing file in OM Workspace.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                </a>
                <a href="#camera-upload">
                    <Card className="h-full transition-colors hover:bg-accent/40">
                        <CardHeader>
                            <CardTitle className="text-base">Camera upload via JPG</CardTitle>
                            <CardDescription>
                                Load a recipe directly into your camera using a SOOC JPG.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                </a>
            </div>

            {/* Section 1: OES */}
            <section id="oes" className="space-y-6 scroll-mt-20">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">
                        How to use OM Workspace batch processing files (.OES)
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                        OES files are OM Workspace presets that apply a saved set of image
                        adjustments — including Color Profile / Color Recipe or Monochrome
                        Creator settings — to any raw (.ORF) file. Note that an OES file can&rsquo;t be loaded directly into the
                        camera; for that, see the{' '}
                        <a href="#camera-upload" className="text-primary underline-offset-4 hover:underline">
                            JPG workflow
                        </a>{' '}
                        below.
                    </p>
                </div>

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
            </section>

            {/* Section 2: Camera upload */}
            <section id="camera-upload" className="space-y-6 scroll-mt-20">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">
                        Load a recipe into your camera using a JPG image
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                        OM System cameras store recipe settings in the EXIF data of
                        straight-out-of-camera JPGs. OM Workspace can read that data and write the
                        recipe directly to your camera — no manual entry required.
                    </p>
                </div>

                <Callout>
                    <strong>Note:</strong> This workflow does <strong>not</strong> transfer white
                    balance settings. You&rsquo;ll need to set those manually on the camera after
                    loading.
                </Callout>

                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <Step number={1}>
                            <p>
                                In OM Workspace, open the <strong>Camera</strong> menu and select{' '}
                                <strong>Load Color/Monochrome Profile</strong>.
                            </p>
                            <StepImage
                                src="/images/how-to/om-camera-upload-1.png"
                                alt="OM Workspace: Camera menu — Load Color/Monochrome Profile"
                                caption="OM Workspace: Camera → Load Color/Monochrome Profile."
                            />
                        </Step>
                        <Step number={2}>
                            <p>Select the recipe JPG file you downloaded from this site.</p>
                            <StepImage
                                src="/images/how-to/om-camera-upload-2.png"
                                alt="OM Workspace: selecting the recipe JPG file"
                                caption="Select the straight-out-of-camera JPG containing the recipe."
                            />
                        </Step>
                        <Step number={3}><p>Click <strong>Next</strong>.</p></Step>
                        <Step number={4}>
                            <p>
                                When prompted, connect your camera via USB and select{' '}
                                <strong>MTP</strong> mode on the camera.
                            </p>
                            <Callout>
                                It can help to wait until OM Workspace prompts you before plugging
                                in — connecting too early sometimes causes it to hang.
                            </Callout>
                        </Step>
                        <Step number={5}>
                            <p>
                                Select which <strong>Custom Mode</strong> slot(s) and{' '}
                                <strong>Color Profile</strong> slot to load the recipe into.
                            </p>
                            <StepImage
                                src="/images/how-to/om-camera-upload-3.png"
                                alt="OM Workspace: selecting Custom Mode and Color Profile slots"
                                caption="Choose which Custom Mode and Color Profile slots to write the recipe to."
                            />
                        </Step>
                        <Step number={6}><p>Click <strong>Load</strong>.</p></Step>
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}
