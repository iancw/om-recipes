import { Card, CardContent } from 'components/ui/card';
import GuideLayout from '../_components/GuideLayout';
import { Step, StepImage, Callout } from '../_components/guide-primitives';

export const metadata = {
    title: 'Load a Recipe Into Your Camera From a JPG',
    description:
        'Use OM Workspace to read a recipe out of a straight-out-of-camera JPG and write it directly to your camera.'
};

export default function CameraFromJpgGuide() {
    return (
        <GuideLayout
            current="camera-from-jpg"
            title="Load a recipe into your camera using a JPG image"
            intro="OM System cameras store recipe settings in the EXIF data of straight-out-of-camera JPGs. OM Workspace can read that data and write the recipe directly to your camera — no manual entry required."
        >
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
        </GuideLayout>
    );
}
