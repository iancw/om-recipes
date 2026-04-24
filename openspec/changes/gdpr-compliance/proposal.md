## Why

OM Recipes already stores personal data across login, profile, uploads, and analytics surfaces, but it does not yet define GDPR-oriented product behavior for consent, access/export, erasure, or retention. This needs to be scoped before implementation so the app's privacy work is coherent across Next.js, Postgres, Netlify, GA4, and OCI-backed storage.

## What Changes

- Add a user-visible privacy and consent experience that explains what data the app collects and keeps optional analytics disabled until the visitor opts in
- Add authenticated self-service privacy controls for exporting account data and requesting account erasure, including user-owned recipes, saved state, and uploaded sample images
- Add request-state tracking for privacy actions so export and deletion can complete safely and present clear status to the user
- Add retention and cleanup rules for auth/session metadata, temporary export artifacts, and abandoned upload objects that contain personal data
- Document the app's third-party processors, configuration requirements, and operational steps for privacy-related workflows

## Capabilities

### New Capabilities
- `privacy-consent-controls`: Privacy notice publication, consent capture, and conditional loading of optional analytics
- `account-data-rights`: Self-service export and erasure workflows for authenticated users and their contributed content
- `personal-data-retention`: Configurable retention windows and cleanup routines for personal-data-bearing records and artifacts

### Modified Capabilities
- (none)

## Impact

- **Layout and navigation**: `app/layout.jsx`, `components/footer.jsx`, new privacy/settings entry points
- **Profile UX**: `app/profile/page.jsx`, `app/profile/profile-form.jsx`, `app/profile/actions.js`
- **Auth data**: `lib/auth.js`, `app/auth/*`, `db/schema.ts`
- **Uploads and storage**: `app/upload/actions.js`, `lib/oci/deleteOrphanedImages.js`, OCI object lifecycle helpers
- **Analytics**: `components/ga4.jsx`, consent persistence helpers, optional cookie handling
- **Operations/docs**: privacy policy content, environment variable docs, retention/cleanup scripts, deployment guidance
