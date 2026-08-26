## ADDED Requirements

### Requirement: Monochrome recipes SHALL support `.oes` batch processing file downloads
The system SHALL generate a valid OM Workspace batch processing (`.oes`) file for `MONO` recipes at `/oes/<slug>.oes`, mirroring the existing `COLOR` recipe export behavior instead of returning an error.

#### Scenario: Downloading a monochrome recipe's OES file succeeds
- **WHEN** a user requests `/oes/<slug>.oes` for a recipe whose type is `MONO`
- **THEN** the system SHALL respond `200` with an XML batch processing file containing a `MonochroCreater` element reflecting that recipe's filter color, filter strength, film tone, and grain settings
- **THEN** the response SHALL NOT be the `409` "not supported yet" error previously returned for monochrome recipes

#### Scenario: Monochrome filter color maps to the correct MonochroCreater HueValue
- **WHEN** the recipe's `monochromeColor` is one of `None`, `Yellow`, `Orange`, `Red`, `Magenta`, `Blue`, `Cyan`, `Green`, or `Yellow-Green` (with or without a trailing "Filter")
- **THEN** the generated `MonochroCreater` element's `HueValue` SHALL be `0` through `8` respectively, matching the order used by the existing monochrome filter wheel UI

#### Scenario: Filter strength is ignored when no filter is active
- **WHEN** the recipe's `monochromeColor` normalizes to "none"
- **THEN** the generated `MonochroCreater` element's `SatValue` SHALL be `0` regardless of any stored `monochromeColorStrength`

#### Scenario: Film tone and grain map to ColorTone and Graininess
- **WHEN** the recipe's `filmHue` is one of `Normal`/`Neutral`, `Sepia`, `Blue`, `Purple`, or `Green`
- **THEN** the generated `MonochroCreater` element's `ColorTone` SHALL be `1` through `5` respectively
- **WHEN** the recipe's `filmGrain` is one of `Off`, `Low`, `Medium`, or `High`
- **THEN** the generated `MonochroCreater` element's `Graininess` SHALL be `0` through `3` respectively

#### Scenario: Recipe card shows the download link for monochrome recipes
- **WHEN** a user views a monochrome recipe card
- **THEN** the UI SHALL show the "OM Workspace Batch Processing File" download link
- **THEN** the UI SHALL NOT show messaging stating that OES downloads are unavailable for monochrome recipes
