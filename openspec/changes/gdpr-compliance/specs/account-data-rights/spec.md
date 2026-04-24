## ADDED Requirements

### Requirement: Authenticated user SHALL be able to export their account data
The system SHALL allow an authenticated user to request an export of the personal data and user-owned content associated with their account, including profile fields, authored recipes, saved recipes, mode-slot assignments, uploaded image metadata, and uploaded original media still present in object storage.

#### Scenario: User requests an export
- **WHEN** an authenticated user starts a data export from the profile privacy controls
- **THEN** the system MUST create a privacy-request record with type `export`
- **THEN** the UI MUST show that the export is in progress or pending

#### Scenario: Export completes successfully
- **WHEN** the export packaging job finishes
- **THEN** the privacy-request record MUST move to a completed state
- **THEN** the user MUST be able to download an archive containing structured account data and any available user-owned uploaded originals

#### Scenario: Export fails
- **WHEN** export generation cannot complete
- **THEN** the privacy-request record MUST move to a failed state
- **THEN** the profile UI MUST surface a retryable failure state without exposing internal secrets

### Requirement: Authenticated user SHALL be able to request account erasure
The system SHALL allow an authenticated user to request erasure of the account and user-owned content, and the flow MUST clearly state that authored recipes, profile data, saved state, sessions, and uploaded sample images will be removed.

#### Scenario: User confirms account deletion
- **WHEN** an authenticated user completes the required confirmation for account deletion
- **THEN** the system MUST create a privacy-request record with type `delete_account`
- **THEN** the user MUST be signed out and all active sessions MUST be revoked promptly

#### Scenario: Erasure completes successfully
- **WHEN** the deletion workflow finishes
- **THEN** the user's first-party records and user-owned content MUST be removed from the app's primary data stores
- **THEN** the privacy-request record MUST be marked completed

#### Scenario: Erasure fails partway through
- **WHEN** the deletion workflow encounters an error
- **THEN** the privacy-request record MUST be marked failed with a non-sensitive failure summary
- **THEN** the system MUST not report success to the user until cleanup completes

### Requirement: Privacy requests SHALL expose durable status
The system SHALL persist request status and timestamps for export and erasure workflows so the profile UI and operators can distinguish pending, completed, and failed requests.

#### Scenario: User revisits the profile page during a pending request
- **WHEN** an authenticated user opens the profile privacy controls while an export or deletion request is still pending
- **THEN** the current request status MUST be shown
- **THEN** the user MUST not be able to create duplicate conflicting requests of the same type

#### Scenario: Operator investigates a completed request
- **WHEN** an operator inspects privacy-request data in the database
- **THEN** the record MUST include request type, requester, state, created/completed timestamps, and failure summary or export artifact reference when applicable
