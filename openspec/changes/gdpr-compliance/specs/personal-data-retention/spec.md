## ADDED Requirements

### Requirement: Personal-data retention windows SHALL be configurable and enforced
The system SHALL define retention windows for time-limited auth records, privacy-request artifacts, and abandoned upload artifacts that contain personal data, and those windows MUST be configurable through deployment settings.

#### Scenario: App starts with retention configuration
- **WHEN** the app or cleanup job loads privacy-retention settings from the environment
- **THEN** it MUST parse explicit durations for auth/session cleanup, export-artifact cleanup, and abandoned-upload cleanup
- **THEN** invalid configuration MUST fail with a clear operator-facing error

#### Scenario: Retention window changes
- **WHEN** an operator updates a retention setting
- **THEN** subsequent cleanup runs MUST enforce the new window without requiring a code change

### Requirement: Expired auth and privacy artifacts SHALL be purged
The system SHALL remove expired magic-link records, expired or revoked sessions older than the configured window, expired export archives, and completed privacy-request records whose audit-retention window has elapsed.

#### Scenario: Cleanup job purges expired auth rows
- **WHEN** a retention cleanup run executes after auth records have aged past their configured windows
- **THEN** expired magic links and expired or revoked sessions outside retention MUST be deleted

#### Scenario: Cleanup job purges expired export artifacts
- **WHEN** a completed export artifact has aged past the configured download window
- **THEN** the stored export archive MUST be deleted
- **THEN** the corresponding privacy-request record MUST no longer reference a live artifact

### Requirement: Abandoned upload objects SHALL be cleaned up
The system SHALL detect and delete upload objects that were staged for recipe processing but never finalized into a durable image association within the configured retention window.

#### Scenario: Prepared upload is abandoned
- **WHEN** a staged upload object remains unfinalized beyond the configured abandoned-upload window
- **THEN** the cleanup process MUST delete the object-storage artifact
- **THEN** any database row that only existed to track the abandoned upload MUST be removed or marked cleaned up

#### Scenario: Finalized upload remains in use
- **WHEN** an image has been finalized into an active recipe or sample relationship
- **THEN** the retention cleanup MUST NOT delete its backing object solely because it is old
