export function getUploadProgressMessage(phase) {
    switch (phase) {
        case 'preparing':
            return {
                title: 'Preparing upload…',
                body: 'Validating the recipe details and preparing the image upload.'
            };
        case 'direct-upload':
            return {
                title: 'Uploading JPG to storage…',
                body: 'Sending the original JPG to storage before it can be attached to the recipe.'
            };
        case 'finalizing':
            return {
                title: 'Finalizing recipe upload…',
                body: 'Attaching the image to the recipe and finishing server-side processing.'
            };
        default:
            return {
                title: 'Uploading…',
                body: 'Working through the upload now.'
            };
    }
}
