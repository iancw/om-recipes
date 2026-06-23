## ADDED Requirements

### Requirement: Recipes SHALL be stored as either color or monochrome
The system SHALL classify every recipe as exactly one recipe type, `COLOR` or `MONO`, and SHALL store its type-specific camera settings in a matching settings record rather than mixing all setting fields directly on the base recipe row.

#### Scenario: Existing color recipes are preserved during migration
- **WHEN** the monochrome-profile change is deployed against a database containing only existing color recipes
- **THEN** each existing recipe SHALL remain addressable at its current URL
- **THEN** each existing recipe SHALL be classified as `COLOR`
- **THEN** each existing recipe SHALL have one corresponding color-settings record containing its prior setting values and fingerprints

#### Scenario: Monochrome recipe cannot also have color settings
- **WHEN** a recipe is classified as `MONO`
- **THEN** the system SHALL persist exactly one monochrome-settings record for that recipe
- **THEN** the system SHALL treat color-only settings as absent for that recipe

### Requirement: Upload parsing SHALL recognize monochrome profile EXIF
The upload pipeline SHALL accept OM/Olympus monochrome profile JPGs by detecting monochrome maker-note fields and parsing the monochrome settings needed to store and display the recipe.

#### Scenario: Monochrome profile upload is parsed successfully
- **WHEN** an uploaded JPG contains monochrome recipe maker notes including `Monochrome Profile Settings`
- **THEN** the system SHALL classify the parsed recipe as `MONO`
- **THEN** the parsed recipe SHALL include the mono-only settings needed by the UI: color filter, filter amount, film grain, film hue, and monochrome vignetting
- **THEN** the parsed recipe SHALL also include any shared tone-curve, white-balance, sharpness, contrast, exposure-compensation, or related slider fields present in the EXIF

#### Scenario: Color profile upload keeps current behavior
- **WHEN** an uploaded JPG contains the existing color recipe maker notes and no monochrome profile settings
- **THEN** the system SHALL continue classifying the parsed recipe as `COLOR`
- **THEN** the current color upload path and validation behavior SHALL remain unchanged

### Requirement: Duplicate detection SHALL be recipe-type aware
The system SHALL compute exact and partial fingerprints separately for color and monochrome recipes and SHALL only compare a pending upload against existing recipes of the same recipe type.

#### Scenario: Monochrome upload matches an existing monochrome recipe
- **WHEN** a monochrome upload produces an exact or partial fingerprint match against an existing monochrome recipe
- **THEN** the system SHALL return the duplicate or near-match result using the same blocking or warning semantics used for color uploads

#### Scenario: Monochrome upload does not match color recipes
- **WHEN** a monochrome upload shares overlapping numeric slider values with a color recipe but differs in recipe type
- **THEN** the system SHALL not treat the color recipe as a duplicate or near-match candidate

### Requirement: Recipe browse SHALL support color and monochrome filtering
The recipe listing experience SHALL show both recipe types by default and SHALL let the user narrow results to only `COLOR` recipes or only `MONO` recipes.

#### Scenario: Default browse shows both recipe types
- **WHEN** a user opens the recipe listing without selecting a recipe-type filter
- **THEN** the results SHALL include both color and monochrome recipes that match the other search criteria

#### Scenario: User filters to monochrome recipes
- **WHEN** a user selects the monochrome-only filter in the browse UI
- **THEN** the system SHALL return and render only recipes whose type is `MONO`

### Requirement: Monochrome recipes SHALL render type-appropriate settings
The recipe card and recipe detail experiences SHALL render monochrome recipes using monochrome-specific settings displays rather than the color saturation-wheel presentation used for color recipes.

#### Scenario: Monochrome recipe detail shows monochrome controls
- **WHEN** a user opens a monochrome recipe card or detail page
- **THEN** the UI SHALL show Mono recipe settings for color filter, film grain, and film hue
- **THEN** the UI SHALL display monochrome vignette strength through the shared `Shading Effect` presentation rather than as a separate monochrome-only row
- **THEN** the UI SHALL NOT show a separate monochrome profile label or value
- **THEN** the UI SHALL shorten monochrome filter labels by removing the redundant `Filter` suffix (for example, show `Red` instead of `Red Filter`)
- **THEN** the UI SHALL show `Filter Amount` only when a monochrome color filter is active, and SHALL hide it when the filter is `None`
- **THEN** the UI SHALL reuse the existing tone-curve, white-balance, and slider presentations for the shared controls available on that recipe instead of introducing separate mono-only versions of those shared widgets
- **THEN** the UI SHALL not render a color saturation wheel for that recipe

### Requirement: Mfilter rendering SHALL define color and level presentation
This section is an OpenSpec scaffold for a follow-up rendering decision. Fill in the scenarios below with the final intended behavior for monochrome filter color and filter level.

#### Scenario: Recipe surfaces show monochrome filter color
- **WHEN** [fill in target surfaces]
- **THEN** [fill in how monochrome filter color should render]

#### Scenario: Recipe surfaces show monochrome filter level
- **WHEN** [fill in when filter level should appear]
- **THEN** [fill in how monochrome filter level should render]

#### Scenario: No-filter state is rendered
- **WHEN** [fill in the no-filter condition]
- **THEN** [fill in how `None` or no active filter should render]

#### Scenario: Color recipe presentation is unchanged
- **WHEN** a user opens a color recipe card or detail page
- **THEN** the UI SHALL continue rendering the existing color saturation wheel and shared adjustment controls

### Requirement: Unsupported color-only exports SHALL not appear on monochrome recipes
The system SHALL not present a color-only `.oes` download action for monochrome recipes until monochrome export behavior has been explicitly implemented and validated.

#### Scenario: Monochrome recipe hides `.oes` download
- **WHEN** a user views a monochrome recipe in any surface that offers recipe downloads
- **THEN** the `.oes` download action SHALL be absent or disabled with explanatory copy

#### Scenario: Color recipe keeps `.oes` download
- **WHEN** a user views a color recipe that currently supports `.oes` export
- **THEN** the `.oes` download action SHALL remain available
