## 1. Privacy Notice And Consent Controls

- [x] 1.1 Add a public privacy notice page and footer/settings entry points that explain data categories, processors, and privacy rights for OM Recipes
- [x] 1.2 Add consent helpers that persist an analytics-consent preference in first-party storage with a default denied state
- [x] 1.3 Update `app/layout.jsx` and `components/ga4.jsx` so GA4 scripts and page-view events only run after analytics consent is granted
- [x] 1.4 Add UI tests or component/integration coverage for first-visit default-denied behavior, opt-in, and consent withdrawal

## 2. Privacy Request Persistence And Profile UX

- [x] 2.1 Add a `privacy_requests` schema and Drizzle migration covering request type, requester, status, artifact metadata, timestamps, and failure summaries
- [x] 2.2 Extend `app/profile/page.jsx`, `app/profile/profile-form.jsx`, and `app/profile/actions.js` with a privacy controls section for export/download status and account deletion confirmation
- [x] 2.3 Prevent duplicate in-flight export or delete requests for the same user and surface durable status in the profile UI

## 3. Data Export Workflow

- [x] 3.1 Implement an export assembler that collects user/account rows, author profile fields, authored recipes, saved recipes, mode-slot assignments, uploaded image metadata, and user-owned original uploads
- [x] 3.2 Package export results into a downloadable archive and attach the artifact location to the completed `privacy_requests` row
- [x] 3.3 Add failure handling and retry-safe status transitions for export generation so partial artifacts are not reported as successful

## 4. Account Erasure Workflow

- [x] 4.1 Implement a deletion service that revokes active sessions, removes magic-link/session history, deletes saved state, deletes authored recipes and sample-image associations, and removes user-owned author/profile records
- [x] 4.2 Reuse or extend OCI cleanup helpers so user-owned uploaded image objects are deleted when erasure removes their final in-app references
- [x] 4.3 Add explicit confirmation copy and post-submit sign-out behavior so deletion scope is clear before the destructive action runs
- [x] 4.4 Add integration coverage proving that completed deletion removes both database records and OCI-backed image references for a test account

## 5. Retention, Cleanup, And Operations

- [x] 5.1 Add environment-backed retention configuration for expired magic links, expired/revoked sessions, completed export artifacts, privacy-request audit rows, and abandoned staged uploads
- [x] 5.2 Implement a cleanup script or scheduled job that purges expired auth/privacy artifacts and removes abandoned upload objects without touching finalized image assets
- [x] 5.3 Add tests for retention parsing, retention cutoffs, export-artifact expiry, and abandoned-upload cleanup behavior
- [x] 5.4 Document deployment steps, processor inventory, retention defaults, and operational expectations for GDPR-related flows
