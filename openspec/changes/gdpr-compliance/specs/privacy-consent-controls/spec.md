## ADDED Requirements

### Requirement: Privacy notice SHALL be publicly accessible
The system SHALL publish a privacy notice that is reachable from global site navigation and explains the categories of personal data the app processes, the purpose of each category, the third-party processors involved, and the ways a user can exercise privacy rights.

#### Scenario: Visitor opens the privacy notice
- **WHEN** a visitor selects the privacy link from the site footer or other global entry point
- **THEN** the app MUST render a privacy notice page
- **THEN** the notice MUST describe account data, profile data, uploaded media, auth/session metadata, analytics usage, and relevant third-party processors

#### Scenario: Logged-in user looks for privacy controls
- **WHEN** an authenticated user visits the profile area
- **THEN** the app MUST provide a visible path to the same privacy notice and the account privacy controls

### Requirement: Optional analytics SHALL remain disabled until consent is granted
The system SHALL default analytics consent to denied and MUST NOT load Google Analytics scripts, set GA cookies, or emit analytics page-view events until the visitor explicitly grants analytics consent.

#### Scenario: Visitor has not granted consent
- **WHEN** a visitor loads any page without an analytics-consent grant
- **THEN** the app MUST not render the GA4 bootstrap script
- **THEN** the app MUST not send analytics events for that visit

#### Scenario: Visitor grants analytics consent
- **WHEN** a visitor explicitly accepts analytics tracking
- **THEN** the app MUST persist the consent preference before the next page view
- **THEN** subsequent navigations MAY load GA4 and emit page-view events

#### Scenario: Visitor withdraws analytics consent
- **WHEN** a visitor changes the preference from granted to denied
- **THEN** the app MUST stop loading GA4 on subsequent navigations
- **THEN** the app MUST expose the updated denied state in the privacy settings UI

### Requirement: Consent preference SHALL be manageable after the initial decision
The system SHALL provide a persistent way for the user to review and change the analytics-consent preference after the first banner or prompt has been dismissed.

#### Scenario: Visitor revisits consent settings
- **WHEN** a visitor opens the privacy settings entry point after making an earlier analytics choice
- **THEN** the current preference MUST be shown
- **THEN** the visitor MUST be able to switch between granted and denied without clearing browser storage manually

#### Scenario: First-time visitor dismisses consent UI without opting in
- **WHEN** a first-time visitor closes the consent prompt without granting analytics consent
- **THEN** the system MUST continue treating analytics as denied by default
