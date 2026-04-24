## Context

The app currently collects several categories of personal data:

- account identifiers in `users` (`email`, verification timestamps)
- public profile fields in `authors` (display name and optional social/website links)
- auth metadata in `auth_magic_links` and `auth_sessions` (IP address, user agent, token lifecycle timestamps)
- user-owned uploads in `images`, plus sample-image relationships and OCI object keys
- saved recipes and mode-slot preferences linked to a user account
- optional Google Analytics instrumentation loaded from `app/layout.jsx`

None of those surfaces currently provide a privacy notice, an analytics consent gate, self-service data export, self-service erasure, or an explicit retention policy. The change is cross-cutting because it touches UI, auth, persistence, OCI object cleanup, and operational documentation.

Stack constraints: Next.js App Router, Drizzle ORM with Postgres, OCI object storage for uploaded images, OCI email delivery for auth mail, and optional GA4 loaded through `next/script`.

## Goals / Non-Goals

**Goals:**
- Keep optional analytics disabled until the visitor explicitly opts in
- Publish a privacy notice that explains collected data, processors, and user rights
- Let authenticated users export their account data and request erasure from the profile area
- Revoke and remove personal data consistently across Postgres and OCI-backed image storage
- Enforce configurable retention windows for time-limited auth and privacy artifacts

**Non-Goals:**
- Delivering legal advice or claiming the app is fully compliant in every jurisdiction
- Building a generic workflow engine for every future user request type
- Replacing GA4, Netlify, or OCI with different vendors
- Implementing manual admin review tooling for privacy requests in this change

## Decisions

### 1. Gate GA4 behind an explicit analytics-consent preference

**Decision:** Add a first-party consent preference that defaults to denied and only render GA4 scripts/page-view tracking after the visitor opts in. The site footer and privacy page will expose a way to review or change the choice later.

**Rationale:** Analytics cookies are optional, not essential to authentication or core site use. Default-deny avoids loading Google tracking before consent is granted and keeps the implementation local to the existing `app/layout.jsx`/`components/ga4.jsx` integration.

**Alternative considered:** Keep GA4 always on and only document it in a policy page. Rejected because it does not change runtime behavior and would leave the app loading optional analytics before consent.

### 2. Use a dedicated privacy-request ledger for export and erasure workflows

**Decision:** Add a `privacy_requests` table that records request type (`export`, `delete_account`), requesting user, current status, timestamps, artifact location for exports, and failure summaries. The profile page will create requests instead of executing all work inline.

**Rationale:** Export packaging and destructive deletion can span multiple tables and OCI object operations. A durable request ledger gives the UI a stable status model, supports retries, and avoids coupling long-running work to a single browser round-trip.

**Alternative considered:** Run export and deletion synchronously inside a single server action. Rejected because large accounts or OCI operations can exceed request budgets and leave the user with ambiguous partial failures.

### 3. Export privacy data as a downloadable archive

**Decision:** Fulfilled export requests will produce an archive that contains a structured `account.json` snapshot plus user-owned uploaded image files that still exist in OCI object storage.

**Rationale:** GDPR portability is stronger if the user receives both structured account data and the media they uploaded, not only database rows. A packaged archive is also simpler for the profile UI than a mix of inline JSON and expiring signed links.

**Alternative considered:** Export only JSON metadata. Rejected because it omits the user's uploaded content and makes the result materially less useful.

### 4. Treat account erasure as hard deletion of user-owned content

**Decision:** Account deletion will revoke active sessions immediately and remove the user's first-party records and user-owned content, including authored recipes, saved recipes, mode-slot assignments, sample-image relationships, and OCI-backed uploaded images.

**Rationale:** The current schema ties authors, recipes, and images together with ownership relationships and existing delete helpers already remove orphaned objects. Hard deletion gives the clearest erasure semantics and avoids retaining public profile content after a user invokes deletion.

**Alternative considered:** Keep published recipes and anonymize only the account/profile. Rejected for this change because it complicates the user promise, requires a separate content-governance policy, and still retains user-contributed data after an erasure request.

### 5. Enforce retention with explicit cleanup jobs and environment-backed windows

**Decision:** Introduce retention configuration for expired magic links, expired/revoked auth sessions, completed export artifacts, completed privacy-request rows beyond the audit window, and abandoned upload objects that were never finalized into a persisted image flow.

**Rationale:** Time-limited auth artifacts and temporary export files should not live indefinitely. Making windows configurable keeps the system adaptable across environments while giving operators a clear set of cleanup routines to schedule.

**Alternative considered:** Rely on ad hoc manual cleanup. Rejected because it is easy to forget, difficult to verify, and undermines the privacy guarantees this change is meant to establish.

## Risks / Trade-offs

Export archives may be expensive for users with many uploaded originals -> Generate archives asynchronously and expire them after a short download window.

Hard deletion can surprise users who only intended to remove login access -> Use explicit confirmation copy that states authored recipes, samples, and saved state will be removed.

Consent stored only in browser state can be lost across devices -> Keep the preference in a first-party cookie and allow logged-in users to revisit it at any time through a visible settings entry point.

Retention cleanup can remove evidence operators still want for debugging -> Scope audit retention separately from auth/session retention and document the trade-off in environment configuration.

## Migration Plan

1. Add schema and migration support for privacy requests and any consent/retention state that must be persisted.
2. Ship the privacy notice and consent gate before enabling any new analytics behavior so optional tracking is never loaded without the new control path.
3. Release export generation and status polling before exposing account deletion so the request ledger is already exercised by a non-destructive flow.
4. Roll out deletion and retention cleanup with conservative windows in staging, then verify DB row removal and OCI object cleanup against test accounts.
5. Enable scheduled cleanup only after confirming exported artifacts and abandoned uploads are deleted as expected in a dry-run or staging pass.

## Open Questions

- Should the consent preference also be mirrored onto authenticated user records for cross-device persistence, or is a browser-local preference sufficient for the first iteration?
- What retention window is acceptable for completed privacy-request audit rows once the export artifact itself has been deleted?
- Does the project want a dedicated public `/privacy` route only, or should the profile page also include a condensed summary of the same processor and rights information?
