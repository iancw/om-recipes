# OM Recipes

OM Recipes is an independent community site for discovering, sharing, and managing color recipes for OM System and Olympus cameras. The app lets photographers browse recipes, compare sample images, upload recipes extracted from camera JPGs, and manage their own submissions over time.

The project is built with Next.js on Netlify and uses Netlify's platform runtime for local development and deployment. It also includes a PostgreSQL-backed data model via Drizzle, passwordless email login, and OCI-backed image and backup workflows.

![OM Recipes site screenshot](docs/readme/site-screenshot.png)

## Contributing

Contributions are welcome! But this is a vibe-coded app without robust testing or independent development support. Let me know if you're interested in contributing or seeing particular features added. I'm happy to consider the code, but it might take time to review and test.

## Local Development

Use Node.js 22 for local development. This repo includes both `.node-version` and `.nvmrc` pinned to `22.22.0`.

For full local functionality, run the app through Netlify CLI rather than plain `next dev`.

1. Install dependencies:

```bash
npm install
```

2. Install the Netlify CLI if you do not already have it:

```bash
npm install -g netlify-cli
```

3. Link the repo to the Netlify site that provides the runtime and database configuration:

```bash
netlify link
```

4. Create or update `.env.local` with the environment variables you need locally.

Minimum useful values:

```bash
APP_BASE_URL=http://localhost:8888
NETLIFY_DATABASE_URL=...
```

If you want login, uploads, OCI image processing, or backups to work locally, you will also need the related OCI and auth variables configured for your environment.

5. Start the local dev server:

```bash
netlify dev
```

Then open `http://localhost:8888`.

If you only need to work on isolated UI code, `npm run dev` may be sufficient, but Netlify-specific features and database-backed flows are expected to work best through `netlify dev`.

## Common Commands

```bash
npm run lint
npm test
npm run build
```

Database-related scripts:

```bash
npm run db:migrate
npm run privacy:cleanup
```

## Environment Notes

Frequently used environment variables in this project include:

- `APP_BASE_URL`
- `NETLIFY_DATABASE_URL`
- `NEXT_PUBLIC_GA4_MEASUREMENT_ID`
- `AUTH_COOKIE_DOMAIN`
- `OCI_EMAIL_DELIVERY_ENDPOINT`
- `OCI_EMAIL_DELIVERY_COMPARTMENT_OCID`
- `OCI_EMAIL_SENDER`
- `OCI_TENANCY_OCID`
- `OCI_USER_OCID`
- `OCI_FINGERPRINT`
- `OCI_PRIVATE_KEY_B64`
- `OCI_REGION`
- `OCI_OBJECT_STORAGE_NAMESPACE`
- `OCI_FUNCTIONS_INVOKE_ENDPOINT`
- `OCI_PROCESS_IMAGE_FUNCTION_ID`
- `OCI_IMAGE_RESIZE_FUNCTION_ID` (legacy fallback during OCI function cutover)
- `OCI_IMAGES_ORIGINAL_BUCKET`
- `OCI_IMAGES_PROCESSED_BUCKET`
- `OCI_DB_BACKUP_BUCKET`
- `AUTH_MAGIC_LINK_RETENTION_DAYS`
- `AUTH_SESSION_RETENTION_DAYS`
- `PRIVACY_EXPORT_RETENTION_HOURS`
- `PRIVACY_REQUEST_AUDIT_RETENTION_DAYS`
- `ABANDONED_UPLOAD_RETENTION_HOURS`

The exact set you need depends on which parts of the app you are working on. Recipe browsing and most database-backed development primarily depend on the Netlify runtime and database connection; auth, uploads, image processing, and backups each require additional configuration.

## Privacy Operations

OM Recipes now exposes a public `/privacy` page, analytics consent controls, profile-based export/deletion requests, and retention cleanup for time-limited privacy artifacts.

- Analytics stays off until the visitor explicitly allows it through the first-party consent control.
- Privacy exports are stored as downloadable archives and expire after `PRIVACY_EXPORT_RETENTION_HOURS`.
- Retention cleanup is handled by `npm run privacy:cleanup`, which purges expired auth/privacy artifacts and abandoned upload objects.
- Third-party processors used by the app include Netlify, Neon/Postgres via Netlify DB, Oracle Cloud Infrastructure, and optional Google Analytics 4.
