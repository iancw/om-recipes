# Upload Status Notifications Design

## Summary

The upload page currently exposes progress only through submit-button labels. That leaves both new recipe uploads and community sample attachments feeling stalled once the user clicks upload. The change will add a persistent inline status alert that stays visible throughout the upload lifecycle and explains the current phase in plain language.

## Goals

- Make upload progress obvious after the user starts any recipe upload.
- Reuse the existing client-side phase state instead of introducing new server behavior.
- Keep the current delayed "longer than usual" notice, but present it as a secondary extension of the visible in-progress state.

## Non-Goals

- No backend or storage workflow changes.
- No percentage-based progress bar.
- No toast-only notification pattern.

## UX

When `uploadStatus === 'uploading'`, the page will show a prominent inline alert above the form content. Its message will change by phase:

- `preparing`: validating recipe details and preparing the upload
- `direct-upload`: uploading the JPG to storage
- `finalizing`: attaching the image to the recipe and processing it

The existing button-label phase text remains in place so the button and page-level status stay synchronized.

If finalization exceeds the current delayed threshold, the existing longer-running notice remains visible below the main in-progress alert.

## Implementation Notes

- Keep the change local to `app/upload/RecipeUpload.jsx`.
- Add a small helper that maps `uploadPhase` to a stable title/body for the inline alert.
- Render the new alert only for `uploadStatus === 'uploading'`.
- Preserve the existing success and error alerts.

## Testing

- Add a focused client test for `RecipeUpload` that mocks the upload actions.
- Verify that starting an upload renders the inline status alert.
- Verify that the alert copy advances through the expected phases until success.
