# Monochrome Profile Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class monochrome recipe support for upload, storage, dedupe, search, and rendering while preserving existing color recipe behavior and leaving monochrome `.oes` export for a later feature.

**Architecture:** Split shared recipe metadata from type-specific settings by adding `recipes.type` plus one child settings row in either `recipe_color_settings` or `recipe_mono_settings`. Introduce normalized recipe query helpers so upload, search, detail, and render paths stop reading color-only columns from `recipes` directly, and make EXIF parsing plus fingerprinting type-aware before validation or duplicate detection.

**Tech Stack:** Next.js App Router, Drizzle ORM, Neon/Postgres, Vitest

---

### Task 1: Add Recipe Typing And Settings Tables

**Files:**
- Modify: `db/schema.ts`
- Create: `migrations/0018_monochrome_profiles.sql`
- Create: `migrations/meta/0018_snapshot.json`
- Test: `tests/schema-monochrome-shape.test.js`

- [ ] **Step 1: Write the failing schema-shape test**

```js
import { describe, expect, it } from 'vitest';
import { recipeColorSettings, recipeMonoSettings, recipes } from '../db/schema.ts';

describe('monochrome recipe schema shape', () => {
    it('defines a recipe type column and dedicated child settings tables', () => {
        expect(recipes.type.name).toBe('type');
        expect(recipeColorSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.recipeId.name).toBe('recipe_id');
        expect(recipeMonoSettings.monochromeColor.name).toBe('monochrome_color');
        expect(recipeMonoSettings.filmGrain.name).toBe('film_grain');
        expect(recipeMonoSettings.monochromeVignetting.name).toBe('monochrome_vignetting');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/schema-monochrome-shape.test.js`
Expected: FAIL because `recipes.type`, `recipeColorSettings`, and `recipeMonoSettings` do not exist yet

- [ ] **Step 3: Add the new schema objects**

```ts
export const recipeTypeEnum = pgEnum('recipe_type', ['COLOR', 'MONO']);

export const recipes = pgTable(
    'recipes',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        uuid: uuid('uuid').defaultRandom().notNull(),
        authorId: integer('author_id').notNull().references(() => authors.id, { onDelete: 'restrict' }),
        slug: varchar('slug', { length: 255 }).notNull(),
        type: recipeTypeEnum('type').notNull().default('COLOR'),
        recipeName: text('recipe_name').notNull(),
        authorName: text('author_name').notNull(),
        description: text('description'),
        source: text('source'),
        sourceUrl: text('source_url'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('recipes_uuid_unique').on(t.uuid),
        uniqueIndex('recipes_slug_unique').on(t.slug),
        index('recipes_type_idx').on(t.type),
        index('recipes_recipe_name_idx').on(t.recipeName),
        index('recipes_author_id_idx').on(t.authorId)
    ]
);

export const recipeColorSettings = pgTable(
    'recipe_color_settings',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        recipeId: integer('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
        yellow: smallint('yellow'),
        orange: smallint('orange'),
        orangeRed: smallint('orange_red'),
        red: smallint('red'),
        magenta: smallint('magenta'),
        violet: smallint('violet'),
        blue: smallint('blue'),
        blueCyan: smallint('blue_cyan'),
        cyan: smallint('cyan'),
        greenCyan: smallint('green_cyan'),
        green: smallint('green'),
        yellowGreen: smallint('yellow_green'),
        contrast: smallint('contrast'),
        sharpness: smallint('sharpness'),
        highlights: smallint('highlights'),
        shadows: smallint('shadows'),
        midtones: smallint('midtones'),
        shadingEffect: smallint('shading_effect').notNull().default(0),
        exposureCompensation: smallint('exposure_compensation').notNull().default(0),
        whiteBalance2: text('white_balance_2'),
        whiteBalanceTemperature: integer('white_balance_temperature'),
        whiteBalanceAmberOffset: smallint('white_balance_amber_offset'),
        whiteBalanceGreenOffset: smallint('white_balance_green_offset'),
        recipeFingerprint: text('recipe_fingerprint'),
        colorFingerprint: text('color_fingerprint'),
        colorToneFingerprint: text('color_tone_fingerprint'),
        noWbFingerprint: text('no_wb_fingerprint')
    },
    (t) => [
        uniqueIndex('recipe_color_settings_recipe_id_unique').on(t.recipeId),
        index('recipe_color_settings_recipe_fingerprint_idx').on(t.recipeFingerprint),
        index('recipe_color_settings_color_fingerprint_idx').on(t.colorFingerprint),
        index('recipe_color_settings_color_tone_fingerprint_idx').on(t.colorToneFingerprint),
        index('recipe_color_settings_no_wb_fingerprint_idx').on(t.noWbFingerprint)
    ]
);

export const recipeMonoSettings = pgTable(
    'recipe_mono_settings',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        recipeId: integer('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
        monochromeProfile: text('monochrome_profile'),
        monochromeColor: text('monochrome_color'),
        monochromeColorStrength: smallint('monochrome_color_strength'),
        filmGrain: text('film_grain'),
        filmHue: text('film_hue'),
        monochromeVignetting: text('monochrome_vignetting'),
        contrast: smallint('contrast'),
        sharpness: smallint('sharpness'),
        highlights: smallint('highlights'),
        shadows: smallint('shadows'),
        midtones: smallint('midtones'),
        shadingEffect: smallint('shading_effect').notNull().default(0),
        exposureCompensation: smallint('exposure_compensation').notNull().default(0),
        whiteBalance2: text('white_balance_2'),
        whiteBalanceTemperature: integer('white_balance_temperature'),
        whiteBalanceAmberOffset: smallint('white_balance_amber_offset'),
        whiteBalanceGreenOffset: smallint('white_balance_green_offset'),
        recipeFingerprint: text('recipe_fingerprint'),
        monoFingerprint: text('mono_fingerprint'),
        monoToneFingerprint: text('mono_tone_fingerprint'),
        monoNoWbFingerprint: text('mono_no_wb_fingerprint')
    },
    (t) => [
        uniqueIndex('recipe_mono_settings_recipe_id_unique').on(t.recipeId),
        index('recipe_mono_settings_recipe_fingerprint_idx').on(t.recipeFingerprint),
        index('recipe_mono_settings_mono_fingerprint_idx').on(t.monoFingerprint),
        index('recipe_mono_settings_mono_tone_fingerprint_idx').on(t.monoToneFingerprint),
        index('recipe_mono_settings_mono_no_wb_fingerprint_idx').on(t.monoNoWbFingerprint)
    ]
);
```

- [ ] **Step 4: Generate and finalize the migration**

```sql
create type recipe_type as enum ('COLOR', 'MONO');

alter table recipes add column type recipe_type not null default 'COLOR';

create table recipe_color_settings (
    id integer generated always as identity primary key,
    recipe_id integer not null references recipes(id) on delete cascade,
    yellow smallint,
    orange smallint,
    orange_red smallint,
    red smallint,
    magenta smallint,
    violet smallint,
    blue smallint,
    blue_cyan smallint,
    cyan smallint,
    green_cyan smallint,
    green smallint,
    yellow_green smallint,
    contrast smallint,
    sharpness smallint,
    highlights smallint,
    shadows smallint,
    midtones smallint,
    shading_effect smallint not null default 0,
    exposure_compensation smallint not null default 0,
    white_balance_2 text,
    white_balance_temperature integer,
    white_balance_amber_offset smallint,
    white_balance_green_offset smallint,
    recipe_fingerprint text,
    color_fingerprint text,
    color_tone_fingerprint text,
    no_wb_fingerprint text
);

create unique index recipe_color_settings_recipe_id_unique on recipe_color_settings(recipe_id);

insert into recipe_color_settings (
    recipe_id, yellow, orange, orange_red, red, magenta, violet, blue, blue_cyan, cyan,
    green_cyan, green, yellow_green, contrast, sharpness, highlights, shadows, midtones,
    shading_effect, exposure_compensation, white_balance_2, white_balance_temperature,
    white_balance_amber_offset, white_balance_green_offset, recipe_fingerprint,
    color_fingerprint, color_tone_fingerprint, no_wb_fingerprint
)
select
    id, yellow, orange, orange_red, red, magenta, violet, blue, blue_cyan, cyan,
    green_cyan, green, yellow_green, contrast, sharpness, highlights, shadows, midtones,
    shading_effect, exposure_compensation, white_balance_2, white_balance_temperature,
    white_balance_amber_offset, white_balance_green_offset, recipe_fingerprint,
    color_fingerprint, color_tone_fingerprint, no_wb_fingerprint
from recipes;

create table recipe_mono_settings (
    id integer generated always as identity primary key,
    recipe_id integer not null references recipes(id) on delete cascade,
    monochrome_profile text,
    monochrome_color text,
    monochrome_color_strength smallint,
    film_grain text,
    film_hue text,
    monochrome_vignetting text,
    contrast smallint,
    sharpness smallint,
    highlights smallint,
    shadows smallint,
    midtones smallint,
    shading_effect smallint not null default 0,
    exposure_compensation smallint not null default 0,
    white_balance_2 text,
    white_balance_temperature integer,
    white_balance_amber_offset smallint,
    white_balance_green_offset smallint,
    recipe_fingerprint text,
    mono_fingerprint text,
    mono_tone_fingerprint text,
    mono_no_wb_fingerprint text
);

create unique index recipe_mono_settings_recipe_id_unique on recipe_mono_settings(recipe_id);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/schema-monochrome-shape.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts migrations/0018_monochrome_profiles.sql migrations/meta/0018_snapshot.json tests/schema-monochrome-shape.test.js
git commit -m "feat: add recipe type settings tables"
```

### Task 2: Make EXIF Parsing And Fingerprinting Type-Aware

**Files:**
- Modify: `lib/exifparse.js`
- Modify: `lib/recipeFingerprint.js`
- Test: `tests/exifparse.test.js`
- Test: `tests/recipeFingerprint.test.js`
- Test fixture input: `openspec/changes/monochrome-profiles/sample-exif/P4070386.JPG.txt`

- [ ] **Step 1: Write the failing mono parser and fingerprint tests**

```js
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRecipeSettingsFromExif } from '../lib/exifparse.js';
import {
    computeRecipeFingerprint,
    computeColorFingerprint,
    computeColorToneFingerprint,
    computeNoWbFingerprint,
    computeMonoFingerprint,
    computeMonoToneFingerprint,
    computeMonoNoWbFingerprint
} from '../lib/recipeFingerprint.js';

describe('monochrome EXIF parsing', () => {
    it('classifies OM monochrome maker notes as MONO', () => {
        const exif = readFileSync('openspec/changes/monochrome-profiles/sample-exif/P4070386.JPG.txt', 'utf8');
        const result = parseRecipeSettingsFromExif(exif);

        expect(result.recipeType).toBe('MONO');
        expect(result.hasMonochromeProfileSettings).toBe(true);
        expect(result.monochromeColor).toBeTruthy();
        expect(result.filmGrain).toBeTruthy();
        expect(result.monochromeVignetting).toBeTruthy();
    });
});

describe('monochrome fingerprints', () => {
    const monoSettings = {
        recipeType: 'MONO',
        monochromeProfile: 'Monotone 2',
        monochromeColor: 'Yellow',
        monochromeColorStrength: 2,
        filmGrain: 'Strong',
        filmHue: 'Sepia',
        monochromeVignetting: 'High',
        contrast: -1,
        sharpness: 1,
        highlights: 2,
        shadows: -2,
        midtones: 0,
        whiteBalanceTemperature: 0,
        whiteBalanceAmberOffset: 0,
        whiteBalanceGreenOffset: 0
    };

    it('changes mono fingerprints when a mono-only control changes', () => {
        expect(computeMonoFingerprint(monoSettings)).not.toBe(
            computeMonoFingerprint({ ...monoSettings, monochromeColor: 'Orange' })
        );
        expect(computeRecipeFingerprint(monoSettings)).not.toBe(
            computeRecipeFingerprint({ ...monoSettings, monochromeColor: 'Orange' })
        );
        expect(computeMonoToneFingerprint(monoSettings)).not.toBe(
            computeMonoToneFingerprint({ ...monoSettings, filmGrain: 'Off' })
        );
        expect(computeMonoNoWbFingerprint(monoSettings)).not.toBe(
            computeMonoNoWbFingerprint({ ...monoSettings, monochromeVignetting: 'Low' })
        );
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/exifparse.test.js tests/recipeFingerprint.test.js`
Expected: FAIL because the parser only understands color settings and fingerprint helpers assume saturation-wheel recipes

- [ ] **Step 3: Extend the parser with recipe typing and monochrome fields**

```js
const pictureMode = getValue(/Picture Mode\s+:([^\n]+)/);
const monochromeProfileSettings = getValue(/Monochrome Profile Settings\s+:(.*)/);
const monochromeColor = getValue(/Monochrome Color\s+:([^\n]+)/) || null;
const filmGrain = getValue(/Film Grain Effect\s+:([^\n]+)/) || null;
const filmHue = getValue(/Monochrome Profile Settings\s+:.*Hue;\s*([^;]+)/) || null;
const monochromeVignetting = getValue(/Monochrome Vignetting\s+:([^\n]+)/) || null;

const isMonochromePictureMode = /mono|monochrome|monotone/i.test(pictureMode);
const hasMonochromeProfileSettings = !isBlank(monochromeProfileSettings);
const recipeType = hasMonochromeProfileSettings || isMonochromePictureMode ? 'MONO' : 'COLOR';

return {
    recipeType,
    hasColorProfileSettings: !isBlank(colorProfile),
    hasMonochromeProfileSettings,
    hasToneLevel: !isBlank(toneLevel),
    monochromeProfile: pictureMode || null,
    monochromeColor,
    monochromeColorStrength: toSmallIntOrNull(
        getValue(/Monochrome Profile Settings\s+:.*Color Filter Strength;\s*(-?\d+)/)
    ),
    filmGrain,
    filmHue,
    monochromeVignetting,
    yellow,
    orange,
    orangeRed,
    red,
    magenta,
    violet,
    blue,
    blueCyan,
    cyan,
    greenCyan,
    green,
    yellowGreen,
    contrast,
    sharpness,
    highlights,
    shadows,
    midtones,
    whiteBalance2,
    whiteBalanceTemperature,
    whiteBalanceAmberOffset,
    whiteBalanceGreenOffset,
    source,
    cameraModelName,
    software
};
```

- [ ] **Step 4: Make the fingerprint helpers branch on recipe type**

```js
function monoPayload(s) {
    return {
        monochromeProfile: normStr(s?.monochromeProfile),
        monochromeColor: normStr(s?.monochromeColor),
        monochromeColorStrength: normInt(s?.monochromeColorStrength),
        filmGrain: normStr(s?.filmGrain),
        filmHue: normStr(s?.filmHue),
        monochromeVignetting: normStr(s?.monochromeVignetting)
    };
}

export function computeColorFingerprint(recipeSettings) {
    return sha256(colorPayload(recipeSettings));
}

export function computeMonoFingerprint(recipeSettings) {
    return sha256(monoPayload(recipeSettings));
}

export function computeColorToneFingerprint(recipeSettings) {
    return sha256({
        ...colorPayload(recipeSettings),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeMonoToneFingerprint(recipeSettings) {
    return sha256({
        ...monoPayload(recipeSettings),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeNoWbFingerprint(recipeSettings) {
    return sha256({
        ...colorPayload(recipeSettings),
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeMonoNoWbFingerprint(recipeSettings) {
    return sha256({
        ...monoPayload(recipeSettings),
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones)
    });
}

export function computeRecipeFingerprint(recipeSettings) {
    const shared = {
        contrast: normInt(recipeSettings?.contrast),
        sharpness: normInt(recipeSettings?.sharpness),
        highlights: normInt(recipeSettings?.highlights),
        shadows: normInt(recipeSettings?.shadows),
        midtones: normInt(recipeSettings?.midtones),
        whiteBalanceTemperature: normInt(recipeSettings?.whiteBalanceTemperature),
        whiteBalanceAmberOffset: normInt(recipeSettings?.whiteBalanceAmberOffset),
        whiteBalanceGreenOffset: normInt(recipeSettings?.whiteBalanceGreenOffset)
    };

    return sha256(
        recipeSettings?.recipeType === 'MONO'
            ? { ...monoPayload(recipeSettings), ...shared }
            : { ...colorPayload(recipeSettings), ...shared }
    );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/exifparse.test.js tests/recipeFingerprint.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/exifparse.js lib/recipeFingerprint.js tests/exifparse.test.js tests/recipeFingerprint.test.js
git commit -m "feat: parse and fingerprint monochrome recipes"
```

### Task 3: Persist Mono Recipes And Scope Duplicate Detection By Type

**Files:**
- Modify: `app/upload/actions.js`
- Modify: `app/recipes/[id]/actions.js`
- Modify: `db/schema.ts`
- Test: `tests/prepare-recipe-upload.test.js`

- [ ] **Step 1: Write the failing upload-action tests**

```js
it('accepts monochrome uploads with monochrome maker notes and writes recipe_mono_settings', async () => {
    selectResults = [[], [], []];
    insertHandlers = [
        () => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([{ id: 777, uuid: 'recipe-uuid-1', slug: 'mono-recipe' }]))
            }))
        }),
        () => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([{ id: 778, recipeId: 777 }]))
            }))
        }),
        () => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
            }))
        })
    ];

    const { prepareRecipeUploadAction } = await loadActionsModule();

    const result = await prepareRecipeUploadAction({
        parameters: {
            author: 'Author',
            name: 'Mono Recipe',
            imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 2048, sha256: 'a'.repeat(64) },
            recipeSettings: {
                recipeType: 'MONO',
                hasMonochromeProfileSettings: true,
                hasToneLevel: true,
                monochromeColor: 'Yellow',
                filmGrain: 'Strong',
                monochromeVignetting: 'High'
            }
        }
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(3);
});

it('does not treat color recipes as duplicate candidates for a monochrome upload', async () => {
    selectResults = [[], [], [], []];
    const { prepareRecipeUploadAction } = await loadActionsModule();

    await prepareRecipeUploadAction({
        parameters: {
            author: 'Author',
            name: 'Mono Recipe',
            imageMeta: { name: 'photo.jpg', type: 'image/jpeg', size: 2048, sha256: 'a'.repeat(64) },
            recipeSettings: {
                recipeType: 'MONO',
                hasMonochromeProfileSettings: true,
                hasToneLevel: true
            }
        }
    });

    expect(selectMock.mock.calls.some((call) => String(call[0]?.where ?? '').includes('recipe_color_settings'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/prepare-recipe-upload.test.js`
Expected: FAIL because uploads still require `hasColorProfileSettings` and only insert into `recipes`

- [ ] **Step 3: Update upload persistence and duplicate lookup**

```js
const isColorRecipe = recipeSettings?.recipeType !== 'MONO';
const hasRequiredRecipeSettings = isColorRecipe
    ? recipeSettings?.hasColorProfileSettings && recipeSettings?.hasToneLevel
    : recipeSettings?.hasMonochromeProfileSettings && recipeSettings?.hasToneLevel;

if (!hasRequiredRecipeSettings) {
    return {
        ok: false,
        error: 'No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.'
    };
}

const recipeFingerprint = computeRecipeFingerprint(recipeSettings);
const colorFingerprint = isColorRecipe ? computeColorFingerprint(recipeSettings) : null;
const colorToneFingerprint = isColorRecipe ? computeColorToneFingerprint(recipeSettings) : null;
const noWbFingerprint = isColorRecipe ? computeNoWbFingerprint(recipeSettings) : null;
const monoFingerprint = isColorRecipe ? null : computeMonoFingerprint(recipeSettings);
const monoToneFingerprint = isColorRecipe ? null : computeMonoToneFingerprint(recipeSettings);
const monoNoWbFingerprint = isColorRecipe ? null : computeMonoNoWbFingerprint(recipeSettings);

const insertedRecipes = await db
    .insert(recipes)
    .values({
        authorId: authorRecord.id,
        slug,
        recipeName: name.trim(),
        authorName: author.trim(),
        description: isBlank(notes) ? null : notes.trim(),
        sourceUrl: normalizeOptionalUrl(sourceUrl),
        type: recipeSettings.recipeType ?? 'COLOR'
    })
    .returning({ id: recipes.id, uuid: recipes.uuid, slug: recipes.slug });

const insertedRecipe = insertedRecipes[0];

if (insertedRecipe && isColorRecipe) {
    await db.insert(recipeColorSettings).values({
        recipeId: insertedRecipe.id,
        yellow: recipeSettings.yellow,
        orange: recipeSettings.orange,
        orangeRed: recipeSettings.orangeRed,
        red: recipeSettings.red,
        magenta: recipeSettings.magenta,
        violet: recipeSettings.violet,
        blue: recipeSettings.blue,
        blueCyan: recipeSettings.blueCyan,
        cyan: recipeSettings.cyan,
        greenCyan: recipeSettings.greenCyan,
        green: recipeSettings.green,
        yellowGreen: recipeSettings.yellowGreen,
        contrast: recipeSettings.contrast,
        sharpness: recipeSettings.sharpness,
        highlights: recipeSettings.highlights,
        shadows: recipeSettings.shadows,
        midtones: recipeSettings.midtones,
        shadingEffect: recipeSettings.shadingEffect ?? 0,
        exposureCompensation: recipeSettings.exposureCompensation ?? 0,
        whiteBalance2: recipeSettings.whiteBalance2,
        whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature,
        whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset,
        whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset,
        recipeFingerprint,
        colorFingerprint,
        colorToneFingerprint,
        noWbFingerprint
    });
} else if (insertedRecipe) {
    await db.insert(recipeMonoSettings).values({
        recipeId: insertedRecipe.id,
        monochromeProfile: recipeSettings.monochromeProfile,
        monochromeColor: recipeSettings.monochromeColor,
        monochromeColorStrength: recipeSettings.monochromeColorStrength,
        filmGrain: recipeSettings.filmGrain,
        filmHue: recipeSettings.filmHue,
        monochromeVignetting: recipeSettings.monochromeVignetting,
        contrast: recipeSettings.contrast,
        sharpness: recipeSettings.sharpness,
        highlights: recipeSettings.highlights,
        shadows: recipeSettings.shadows,
        midtones: recipeSettings.midtones,
        shadingEffect: recipeSettings.shadingEffect ?? 0,
        exposureCompensation: recipeSettings.exposureCompensation ?? 0,
        whiteBalance2: recipeSettings.whiteBalance2,
        whiteBalanceTemperature: recipeSettings.whiteBalanceTemperature,
        whiteBalanceAmberOffset: recipeSettings.whiteBalanceAmberOffset,
        whiteBalanceGreenOffset: recipeSettings.whiteBalanceGreenOffset,
        recipeFingerprint,
        monoFingerprint,
        monoToneFingerprint,
        monoNoWbFingerprint
    });
}
```

- [ ] **Step 4: Update edit-action fingerprint refresh to read child tables**

```js
const existing = await db
    .select({
        recipe: {
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,
            type: recipes.type
        },
        color: recipeColorSettings,
        mono: recipeMonoSettings
    })
    .from(recipes)
    .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
    .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
    .where(and(eq(recipes.id, recipeId), inArray(recipes.authorId, authorIds)))
    .limit(1);

const settings = existing[0].recipe.type === 'MONO' ? existing[0].mono : existing[0].color;
const typedSettings = { recipeType: existing[0].recipe.type, ...settings };
const recipeFingerprint = computeRecipeFingerprint(typedSettings);
const colorFingerprint = existing[0].recipe.type === 'COLOR' ? computeColorFingerprint(typedSettings) : null;
const colorToneFingerprint = existing[0].recipe.type === 'COLOR' ? computeColorToneFingerprint(typedSettings) : null;
const noWbFingerprint = existing[0].recipe.type === 'COLOR' ? computeNoWbFingerprint(typedSettings) : null;
const monoFingerprint = existing[0].recipe.type === 'MONO' ? computeMonoFingerprint(typedSettings) : null;
const monoToneFingerprint = existing[0].recipe.type === 'MONO' ? computeMonoToneFingerprint(typedSettings) : null;
const monoNoWbFingerprint = existing[0].recipe.type === 'MONO' ? computeMonoNoWbFingerprint(typedSettings) : null;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/prepare-recipe-upload.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/upload/actions.js app/recipes/[id]/actions.js tests/prepare-recipe-upload.test.js db/schema.ts
git commit -m "feat: store monochrome uploads in dedicated settings tables"
```

### Task 4: Normalize Recipe Reads And Render Mono UI

**Files:**
- Create: `lib/recipe-data.js`
- Modify: `app/recipes/search/route.js`
- Modify: `app/recipes/[id]/page.jsx`
- Modify: `app/page.jsx`
- Modify: `components/RecipeSettings.jsx`
- Modify: `components/recipe-card.jsx`
- Modify: `app/oes/[slug]/route.js`
- Modify: `app/upload/RecipeUpload.jsx`
- Modify: `app/upload/page.jsx`
- Test: `tests/recipe-data.test.js`
- Test: `tests/recipe-search-route.test.js`

- [ ] **Step 1: Write the failing normalized-read and filter tests**

```js
import { describe, expect, it } from 'vitest';
import { buildRecipeViewModel } from '../lib/recipe-data.js';

describe('buildRecipeViewModel', () => {
    it('returns mono settings without saturation wheel values for MONO recipes', () => {
        const recipe = buildRecipeViewModel({
            recipe: { id: 1, slug: 'mono', type: 'MONO', recipeName: 'Mono', authorName: 'Author' },
            mono: { monochromeColor: 'Yellow', monochromeColorStrength: 2, filmGrain: 'Strong', filmHue: 'Sepia', monochromeVignetting: 'High' },
            color: null
        });

        expect(recipe.type).toBe('MONO');
        expect(recipe.monochromeColor).toBe('Yellow');
        expect(recipe.yellow).toBeUndefined();
    });
});

describe('/recipes/search type filter', () => {
    it('accepts a MONO recipeType filter in the query string', async () => {
        const request = new Request('https://example.com/recipes/search?recipeType=MONO');
        const response = await GET(request);
        expect(response.status).toBe(200);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/recipe-data.test.js tests/recipe-search-route.test.js`
Expected: FAIL because there is no shared recipe view-model layer and no `recipeType` filter

- [ ] **Step 3: Add a shared recipe view-model helper**

```js
export function buildRecipeViewModel({ recipe, color, mono, authorSocial = null }) {
    const settings = recipe?.type === 'MONO' ? mono : color;

    return {
        id: recipe.id,
        uuid: recipe.uuid,
        slug: recipe.slug,
        type: recipe.type,
        recipeName: recipe.recipeName,
        authorName: recipe.authorName,
        description: recipe.description,
        sourceUrl: recipe.sourceUrl,
        createdAt: recipe.createdAt,
        authorId: recipe.authorId,
        authorSocial,
        ...(recipe.type === 'MONO'
            ? {
                  monochromeProfile: settings?.monochromeProfile ?? null,
                  monochromeColor: settings?.monochromeColor ?? null,
                  monochromeColorStrength: settings?.monochromeColorStrength ?? null,
                  filmGrain: settings?.filmGrain ?? null,
                  filmHue: settings?.filmHue ?? null,
                  monochromeVignetting: settings?.monochromeVignetting ?? null
              }
            : {
                  yellow: settings?.yellow ?? 0,
                  orange: settings?.orange ?? 0,
                  orangeRed: settings?.orangeRed ?? 0,
                  red: settings?.red ?? 0,
                  magenta: settings?.magenta ?? 0,
                  violet: settings?.violet ?? 0,
                  blue: settings?.blue ?? 0,
                  blueCyan: settings?.blueCyan ?? 0,
                  cyan: settings?.cyan ?? 0,
                  greenCyan: settings?.greenCyan ?? 0,
                  green: settings?.green ?? 0,
                  yellowGreen: settings?.yellowGreen ?? 0
              }),
        contrast: settings?.contrast ?? 0,
        sharpness: settings?.sharpness ?? 0,
        highlights: settings?.highlights ?? 0,
        shadows: settings?.shadows ?? 0,
        midtones: settings?.midtones ?? 0,
        shadingEffect: settings?.shadingEffect ?? 0,
        exposureCompensation: settings?.exposureCompensation ?? 0,
        whiteBalance2: settings?.whiteBalance2 ?? null,
        whiteBalanceTemperature: settings?.whiteBalanceTemperature ?? null,
        whiteBalanceAmberOffset: settings?.whiteBalanceAmberOffset ?? null,
        whiteBalanceGreenOffset: settings?.whiteBalanceGreenOffset ?? null
    };
}
```

- [ ] **Step 4: Convert search, detail, and render paths to the normalized model**

```js
const recipeType = searchParams.get('recipeType');
if (recipeType === 'COLOR' || recipeType === 'MONO') {
    filters.push(eq(recipes.type, recipeType));
}

const baseRecipes = await db
    .select({
        recipe: {
            id: recipes.id,
            uuid: recipes.uuid,
            slug: recipes.slug,
            type: recipes.type,
            recipeName: recipes.recipeName,
            authorName: recipes.authorName,
            description: recipes.description,
            sourceUrl: recipes.sourceUrl,
            createdAt: recipes.createdAt,
            authorId: recipes.authorId
        },
        color: recipeColorSettings,
        mono: recipeMonoSettings,
        authorSocial: {
            instagram: authors.instagramLink,
            flickr: authors.flickrLink,
            website: authors.website,
            kofi: authors.kofiLink
        }
    })
    .from(recipes)
    .leftJoin(authors, eq(authors.id, recipes.authorId))
    .leftJoin(recipeColorSettings, eq(recipeColorSettings.recipeId, recipes.id))
    .leftJoin(recipeMonoSettings, eq(recipeMonoSettings.recipeId, recipes.id))
    .where(where)
    .groupBy(recipes.id, recipeColorSettings.id, recipeMonoSettings.id, authors.id)
    .orderBy(...orderBy)
    .limit(fetchLimit)
    .offset(offset);

const results = pageRecipes.map((row) => buildRecipeViewModel(row));
```

- [ ] **Step 5: Render mono settings and suppress `.oes` for mono recipes**

```jsx
export default function RecipeSettings({ recipe }) {
  const isMono = recipe?.type === 'MONO';

  return (
    <div className="recipe-card-settings-flex">
      {!isMono ? (
        <div className="saturation-wheel-container">
          <SaturationWheel values={[Number(recipe.yellow ?? 0), Number(recipe.orange ?? 0), Number(recipe.orangeRed ?? 0), Number(recipe.red ?? 0), Number(recipe.magenta ?? 0), Number(recipe.violet ?? 0), Number(recipe.blue ?? 0), Number(recipe.blueCyan ?? 0), Number(recipe.cyan ?? 0), Number(recipe.greenCyan ?? 0), Number(recipe.green ?? 0), Number(recipe.yellowGreen ?? 0)]} />
        </div>
      ) : (
        <div className="rounded-md border bg-card/60 p-4 text-sm">
          <div><strong>Mono Color:</strong> {recipe.monochromeColor ?? 'Off'}</div>
          <div><strong>Filter Amount:</strong> {recipe.monochromeColorStrength ?? 0}</div>
          <div><strong>Film Grain:</strong> {recipe.filmGrain ?? 'Off'}</div>
          <div><strong>Film Hue:</strong> {recipe.filmHue ?? 'Neutral'}</div>
          <div><strong>Vignetting:</strong> {recipe.monochromeVignetting ?? 'Off'}</div>
        </div>
      )}
      <ShadowMidsHighlightAdjust
        shadows={Number(recipe.shadows ?? 0)}
        mids={Number(recipe.midtones ?? 0)}
        highlights={Number(recipe.highlights ?? 0)}
      />
      <div>
        <WhiteBalanceBox
          wb={recipe.whiteBalance2}
          wbTemperature={recipe.whiteBalanceTemperature}
          green={recipe.whiteBalanceGreenOffset ?? 0}
          amber={recipe.whiteBalanceAmberOffset ?? 0}
        />
        <ImageAdjustSliders
          vignette={recipe.shadingEffect}
          sharpness={recipe.sharpness}
          contrast={recipe.contrast}
          exposureCompensation={(recipe.exposureCompensation || 0) / 10}
        />
      </div>
    </div>
  );
}
```

```jsx
const isMonoRecipe = recipe?.type === 'MONO';

{!isMonoRecipe ? (
  <a href={oesHref} className={buttonVariants({ variant: 'outline' })}>Download OES</a>
) : (
  <Badge variant="secondary">Monochrome export not supported yet</Badge>
)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/recipe-data.test.js tests/recipe-search-route.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/recipe-data.js app/recipes/search/route.js app/recipes/[id]/page.jsx app/page.jsx components/RecipeSettings.jsx components/recipe-card.jsx app/oes/[slug]/route.js app/upload/RecipeUpload.jsx app/upload/page.jsx tests/recipe-data.test.js tests/recipe-search-route.test.js
git commit -m "feat: render monochrome recipes across browse and detail views"
```

### Task 5: Final Verification And Cleanup

**Files:**
- Modify: `README.md`
- Modify: `openspec/changes/monochrome-profiles/tasks.md`

- [ ] **Step 1: Update user-facing copy that still says color-only**

```md
Minimum useful values:

- `APP_BASE_URL=http://localhost:8888`
- `NETLIFY_DATABASE_URL=...`

Recipe browsing, upload parsing, and recipe-detail rendering now support both OM System color recipes and monochrome profiles. `.oes` downloads remain color-only until a validated monochrome export path exists.
```

- [ ] **Step 2: Run the focused test suite**

Run: `npm test -- tests/schema-monochrome-shape.test.js tests/exifparse.test.js tests/recipeFingerprint.test.js tests/prepare-recipe-upload.test.js tests/recipe-data.test.js tests/recipe-search-route.test.js`
Expected: PASS

- [ ] **Step 3: Run the broader repo quality gates**

Run: `npm test`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Verify migration behavior against the live schema**

Run: `npm run db:migrate`
Expected: PASS with `recipes.type`, `recipe_color_settings`, and `recipe_mono_settings` created and all existing recipes backfilled into `recipe_color_settings`

Run: `node -e "console.log('manual smoke checks: existing color recipe, new mono upload, mixed browse results')"`
Expected: reminder output for the three manual checks required before handoff

- [ ] **Step 5: Commit**

```bash
git add README.md openspec/changes/monochrome-profiles/tasks.md
git commit -m "docs: document monochrome recipe support rollout"
```

- [ ] **Step 6: Push and close out**

```bash
git push
git status
```

Expected: `git push` succeeds and `git status` shows a clean branch
