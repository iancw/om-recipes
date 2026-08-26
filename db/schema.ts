import { relations, sql } from 'drizzle-orm';
import {
    boolean,
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar
} from 'drizzle-orm/pg-core';

/**
 * Schema notes / conventions:
 * - Postgres dialect (Neon via Netlify DB).
 * - `users` are first-party login identities (email + session-backed auth).
 * - `authors` are public recipe owners/profiles and may optionally belong to a user.
 */

export const recipeTypeEnum = pgEnum('recipe_type', ['COLOR', 'MONO']);
export const notificationTypeEnum = pgEnum('notification_type', ['new_recipe', 'recipe_saved', 'sample_image_added']);

export const users = pgTable(
    'users',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        uuid: uuid('uuid').defaultRandom().notNull(),
        email: text('email').notNull(),
        emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [uniqueIndex('users_uuid_unique').on(t.uuid), uniqueIndex('users_email_unique').on(t.email)]
);

export const authors = pgTable(
    'authors',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

        // Public identifier used in URLs.
        uuid: uuid('uuid').defaultRandom().notNull(),

        // Legacy unused field kept temporarily to simplify the Auth0 removal migration.
        oidcSub: text('oidc_sub'),

        // Nullable so imported recipes can reference authors with no login identity.
        userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),

        name: text('name').notNull(),
        instagramLink: text('instagram_link'),
        flickrLink: text('flickr_link'),
        website: text('website'),
        kofiLink: text('kofi_link'),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('authors_uuid_unique').on(t.uuid),
        uniqueIndex('authors_oidc_sub_unique').on(t.oidcSub).where(sql`${t.oidcSub} is not null`),
        index('authors_name_idx').on(t.name)
    ]
);

export const authMagicLinks = pgTable(
    'auth_magic_links',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: text('token_hash').notNull(),
        redirectTo: text('redirect_to'),
        requestedIp: text('requested_ip'),
        requestedUserAgent: text('requested_user_agent'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        consumedAt: timestamp('consumed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('auth_magic_links_token_hash_unique').on(t.tokenHash),
        index('auth_magic_links_user_id_idx').on(t.userId),
        index('auth_magic_links_expires_at_idx').on(t.expiresAt)
    ]
);

export const authSessions = pgTable(
    'auth_sessions',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: text('token_hash').notNull(),
        userAgent: text('user_agent'),
        ipAddress: text('ip_address'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('auth_sessions_token_hash_unique').on(t.tokenHash),
        index('auth_sessions_user_id_idx').on(t.userId),
        index('auth_sessions_expires_at_idx').on(t.expiresAt)
    ]
);

export const privacyRequests = pgTable(
    'privacy_requests',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

        // Public identifier used in URLs (the download link), so request
        // ids can't be enumerated/guessed via the sequential integer id.
        uuid: uuid('uuid').defaultRandom().notNull(),

        userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
        subjectUserUuid: uuid('subject_user_uuid').notNull(),
        requestType: varchar('request_type', { length: 32 }).notNull(),
        status: varchar('status', { length: 32 }).notNull().default('pending'),
        artifactKey: text('artifact_key'),
        artifactContentType: text('artifact_content_type'),
        artifactFileName: text('artifact_file_name'),
        artifactSizeBytes: integer('artifact_size_bytes'),
        artifactExpiresAt: timestamp('artifact_expires_at', { withTimezone: true }),
        failureSummary: text('failure_summary'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true })
    },
    (t) => [
        uniqueIndex('privacy_requests_uuid_unique').on(t.uuid),
        index('privacy_requests_user_id_idx').on(t.userId),
        index('privacy_requests_subject_user_uuid_idx').on(t.subjectUserUuid),
        index('privacy_requests_type_status_idx').on(t.requestType, t.status),
        index('privacy_requests_created_at_idx').on(t.createdAt),
        uniqueIndex('privacy_requests_user_request_type_inflight_unique')
            .on(t.userId, t.requestType)
            .where(sql`${t.userId} is not null and ${t.status} in ('pending', 'processing')`)
    ]
);

export const images = pgTable(
    'images',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

        // Public identifier used in URLs.
        uuid: uuid('uuid').defaultRandom().notNull(),
        authorId: integer('author_id')
            .notNull()
            .references(() => authors.id, { onDelete: 'cascade' }),

        dimensions: text('dimensions'),
        camera: text('camera'),
        lens: text('lens'),
        originalFileSize: integer('original_file_size'),
        exif: text('exif_string'),
        validExif: boolean('valid_exif').default(false).notNull(),
        preparedRecipeId: integer('prepared_recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
        preparedObjectKey: text('prepared_object_key'),
        finalizedAt: timestamp('finalized_at', { withTimezone: true }),
        fullSizeUrl: text('full_size_url'),
        smallUrl: text('small_url'),
        copyright: boolean('copyright').default(true).notNull(),
        sha256Hash: text('sha256_hash'),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('images_uuid_unique').on(t.uuid),
        index('images_author_id_idx').on(t.authorId),
        index('images_prepared_recipe_id_idx').on(t.preparedRecipeId),
        uniqueIndex('images_prepared_object_key_unique').on(t.preparedObjectKey).where(sql`${t.preparedObjectKey} is not null`),
        uniqueIndex('images_sha256_hash_unique').on(t.sha256Hash).where(sql`${t.sha256Hash} is not null`)
    ]
);

export const recipes = pgTable(
    'recipes',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

        // Public identifier used in URLs.
        uuid: uuid('uuid').defaultRandom().notNull(),

        authorId: integer('author_id')
            .notNull()
            .references(() => authors.id, { onDelete: 'restrict' }),

        slug: varchar('slug', { length: 255 }).notNull(),
        type: recipeTypeEnum('type').notNull().default('COLOR'),

        recipeName: text('recipe_name').notNull(),
        // Denormalized display name from the source schema/JSON.
        authorName: text('author_name').notNull(),
        description: text('description'),
        source: text('source'),
        sourceUrl: text('source_url'),

        // Transitional: later tasks will move runtime reads/writes to the child settings tables.
        // These legacy color/fingerprint columns stay on `recipes` only until that refactor lands.
        // Saturation wheel adjustments
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

        // Sliders
        contrast: smallint('contrast'),
        sharpness: smallint('sharpness'),
        highlights: smallint('highlights'),
        shadows: smallint('shadows'),
        midtones: smallint('midtones'),

        // Additional OM image adjustments
        shadingEffect: smallint('shading_effect').notNull().default(0),
        exposureCompensation: smallint('exposure_compensation').notNull().default(0),

        // White balance
        whiteBalance2: text('white_balance_2'),
        whiteBalanceTemperature: integer('white_balance_temperature'),
        whiteBalanceAmberOffset: smallint('white_balance_amber_offset'),
        whiteBalanceGreenOffset: smallint('white_balance_green_offset'),

        // OES downloads are generated dynamically at /oes/<slug>.oes

        // Fingerprint of core recipe settings (for dedupe / matching).
        // Intentionally excludes shadingEffect and exposureCompensation.
        recipeFingerprint: text('recipe_fingerprint'),

        // Partial fingerprints for similarity matching at different granularities.
        colorFingerprint: text('color_fingerprint'),
        colorToneFingerprint: text('color_tone_fingerprint'),
        noWbFingerprint: text('no_wb_fingerprint'),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('recipes_uuid_unique').on(t.uuid),
        uniqueIndex('recipes_slug_unique').on(t.slug),
        index('recipes_type_idx').on(t.type),
        index('recipes_recipe_fingerprint_idx').on(t.recipeFingerprint),
        index('recipes_color_fingerprint_idx').on(t.colorFingerprint),
        index('recipes_color_tone_fingerprint_idx').on(t.colorToneFingerprint),
        index('recipes_no_wb_fingerprint_idx').on(t.noWbFingerprint),
        index('recipes_recipe_name_idx').on(t.recipeName),
        index('recipes_author_id_idx').on(t.authorId)
    ]
);

// Transitional destination for color-specific settings once runtime code stops reading legacy columns on `recipes`.
export const recipeColorSettings = pgTable(
    'recipe_color_settings',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
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

// Transitional destination for monochrome-specific settings keyed by the parent recipe row.
export const recipeMonoSettings = pgTable(
    'recipe_mono_settings',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
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

export const recipeSampleImages = pgTable(
    'recipe_sample_images',
    {
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        imageId: integer('image_id')
            .notNull()
            .references(() => images.id, { onDelete: 'cascade' }),
        authorId: integer('author_id').references(() => authors.id, { onDelete: 'set null' }),
        isPrimary: boolean('is_primary').notNull().default(false)
    },
    (t) => [
        primaryKey({ columns: [t.recipeId, t.imageId], name: 'recipe_sample_images_pk' }),
        index('recipe_sample_images_recipe_id_idx').on(t.recipeId),
        index('recipe_sample_images_author_id_idx').on(t.authorId)
    ]
);

// Join table for side-by-side / comparison images for a recipe.
// Intentionally does NOT include author_id; the image already belongs to an author.
export const recipeComparisonImages = pgTable(
    'recipe_comparison_images',
    {
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        imageId: integer('image_id')
            .notNull()
            .references(() => images.id, { onDelete: 'cascade' }),

        // Optional display label for UI (e.g. "Before", "After", "RAW", "JPEG")
        label: text('label')
    },
    (t) => [
        primaryKey({ columns: [t.recipeId, t.imageId], name: 'recipe_comparison_images_pk' }),
        index('recipe_comparison_images_recipe_id_idx').on(t.recipeId)
    ]
);

export const savedRecipes = pgTable(
    'saved_recipes',
    {
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        primaryKey({ columns: [t.userId, t.recipeId], name: 'saved_recipes_pk' }),
        index('saved_recipes_user_id_idx').on(t.userId),
        index('saved_recipes_recipe_id_idx').on(t.recipeId)
    ]
);

// Tracks which recipes a user has loaded into each camera mode dial position and color profile slot.
// modePosition: one of c1, c2, c3, c4, c5, pasmb (P/A/S/M/B shared position)
// colorSlot: 1–4 (Color 1 through Color 4)
export const modeSlotAssignments = pgTable(
    'mode_slot_assignments',
    {
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        modePosition: varchar('mode_position', { length: 10 }).notNull(),
        colorSlot: smallint('color_slot').notNull(),
        // Nullable: if the recipe is deleted, the slot is preserved but shows as unavailable.
        recipeId: integer('recipe_id').references(() => recipes.id, { onDelete: 'set null' })
    },
    (t) => [
        primaryKey({ columns: [t.userId, t.modePosition, t.colorSlot], name: 'mode_slot_assignments_pk' }),
        index('mode_slot_assignments_user_id_idx').on(t.userId),
        index('mode_slot_assignments_recipe_id_idx').on(t.recipeId)
    ]
);

export const notifications = pgTable(
    'notifications',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        uuid: uuid('uuid').defaultRandom().notNull(),
        recipientUserId: integer('recipient_user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        type: notificationTypeEnum('type').notNull(),
        recipeId: integer('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        actorAuthorId: integer('actor_author_id').references(() => authors.id, { onDelete: 'set null' }),
        sampleImageId: integer('sample_image_id').references(() => images.id, { onDelete: 'set null' }),
        dedupeKey: text('dedupe_key').notNull(),
        readAt: timestamp('read_at', { withTimezone: true }),
        emailedAt: timestamp('emailed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [
        uniqueIndex('notifications_uuid_unique').on(t.uuid),
        uniqueIndex('notifications_dedupe_key_unique').on(t.dedupeKey),
        index('notifications_recipient_user_id_read_at_idx').on(t.recipientUserId, t.readAt),
        index('notifications_recipient_user_id_created_at_idx').on(t.recipientUserId, t.createdAt),
        index('notifications_emailed_at_idx').on(t.emailedAt).where(sql`${t.emailedAt} is null`)
    ]
);

export const notificationPreferences = pgTable(
    'notification_preferences',
    {
        id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        notifyNewRecipe: boolean('notify_new_recipe').notNull().default(false),
        notifySampleImage: boolean('notify_sample_image').notNull().default(true),
        notifySave: boolean('notify_save').notNull().default(true),
        emailDigestEnabled: boolean('email_digest_enabled').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    },
    (t) => [uniqueIndex('notification_preferences_user_id_unique').on(t.userId)]
);

export const usersRelations = relations(users, ({ many, one }) => ({
    authors: many(authors),
    magicLinks: many(authMagicLinks),
    sessions: many(authSessions),
    privacyRequests: many(privacyRequests),
    savedRecipes: many(savedRecipes),
    modeSlotAssignments: many(modeSlotAssignments),
    notifications: many(notifications),
    notificationPreferences: one(notificationPreferences, {
        fields: [users.id],
        references: [notificationPreferences.userId]
    })
}));

export const authorsRelations = relations(authors, ({ one, many }) => ({
    user: one(users, {
        fields: [authors.userId],
        references: [users.id]
    }),
    recipes: many(recipes),
    images: many(images),
    sampleImages: many(recipeSampleImages)
}));

export const imagesRelations = relations(images, ({ one, many }) => ({
    author: one(authors, {
        fields: [images.authorId],
        references: [authors.id]
    }),
    sampleFor: many(recipeSampleImages),
    comparisonImageFor: many(recipeComparisonImages)
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
    author: one(authors, {
        fields: [recipes.authorId],
        references: [authors.id]
    }),
    colorSettings: one(recipeColorSettings, {
        fields: [recipes.id],
        references: [recipeColorSettings.recipeId]
    }),
    monoSettings: one(recipeMonoSettings, {
        fields: [recipes.id],
        references: [recipeMonoSettings.recipeId]
    }),
    sampleImages: many(recipeSampleImages),
    comparisonImages: many(recipeComparisonImages),
    savedByUsers: many(savedRecipes)
}));

export const recipeColorSettingsRelations = relations(recipeColorSettings, ({ one }) => ({
    recipe: one(recipes, {
        fields: [recipeColorSettings.recipeId],
        references: [recipes.id]
    })
}));

export const recipeMonoSettingsRelations = relations(recipeMonoSettings, ({ one }) => ({
    recipe: one(recipes, {
        fields: [recipeMonoSettings.recipeId],
        references: [recipes.id]
    })
}));

export const recipeSampleImagesRelations = relations(recipeSampleImages, ({ one }) => ({
    recipe: one(recipes, {
        fields: [recipeSampleImages.recipeId],
        references: [recipes.id]
    }),
    image: one(images, {
        fields: [recipeSampleImages.imageId],
        references: [images.id]
    }),
    author: one(authors, {
        fields: [recipeSampleImages.authorId],
        references: [authors.id]
    })
}));

export const recipeComparisonImagesRelations = relations(recipeComparisonImages, ({ one }) => ({
    recipe: one(recipes, {
        fields: [recipeComparisonImages.recipeId],
        references: [recipes.id]
    }),
    image: one(images, {
        fields: [recipeComparisonImages.imageId],
        references: [images.id]
    })
}));

export const savedRecipesRelations = relations(savedRecipes, ({ one }) => ({
    user: one(users, {
        fields: [savedRecipes.userId],
        references: [users.id]
    }),
    recipe: one(recipes, {
        fields: [savedRecipes.recipeId],
        references: [recipes.id]
    })
}));

export const authMagicLinksRelations = relations(authMagicLinks, ({ one }) => ({
    user: one(users, {
        fields: [authMagicLinks.userId],
        references: [users.id]
    })
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
    user: one(users, {
        fields: [authSessions.userId],
        references: [users.id]
    })
}));

export const privacyRequestsRelations = relations(privacyRequests, ({ one }) => ({
    user: one(users, {
        fields: [privacyRequests.userId],
        references: [users.id]
    })
}));

export const modeSlotAssignmentsRelations = relations(modeSlotAssignments, ({ one }) => ({
    user: one(users, {
        fields: [modeSlotAssignments.userId],
        references: [users.id]
    }),
    recipe: one(recipes, {
        fields: [modeSlotAssignments.recipeId],
        references: [recipes.id]
    })
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
    recipient: one(users, {
        fields: [notifications.recipientUserId],
        references: [users.id]
    }),
    recipe: one(recipes, {
        fields: [notifications.recipeId],
        references: [recipes.id]
    }),
    actorAuthor: one(authors, {
        fields: [notifications.actorAuthorId],
        references: [authors.id]
    }),
    sampleImage: one(images, {
        fields: [notifications.sampleImageId],
        references: [images.id]
    })
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
    user: one(users, {
        fields: [notificationPreferences.userId],
        references: [users.id]
    })
}));
