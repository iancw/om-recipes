CREATE TYPE "public"."recipe_type" AS ENUM('COLOR', 'MONO');--> statement-breakpoint
CREATE TABLE "recipe_color_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recipe_color_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipe_id" integer NOT NULL,
	"yellow" smallint,
	"orange" smallint,
	"orange_red" smallint,
	"red" smallint,
	"magenta" smallint,
	"violet" smallint,
	"blue" smallint,
	"blue_cyan" smallint,
	"cyan" smallint,
	"green_cyan" smallint,
	"green" smallint,
	"yellow_green" smallint,
	"contrast" smallint,
	"sharpness" smallint,
	"highlights" smallint,
	"shadows" smallint,
	"midtones" smallint,
	"shading_effect" smallint DEFAULT 0 NOT NULL,
	"exposure_compensation" smallint DEFAULT 0 NOT NULL,
	"white_balance_2" text,
	"white_balance_temperature" integer,
	"white_balance_amber_offset" smallint,
	"white_balance_green_offset" smallint,
	"recipe_fingerprint" text,
	"color_fingerprint" text,
	"color_tone_fingerprint" text,
	"no_wb_fingerprint" text
);
--> statement-breakpoint
CREATE TABLE "recipe_mono_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recipe_mono_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipe_id" integer NOT NULL,
	"monochrome_profile" text,
	"monochrome_color" text,
	"monochrome_color_strength" smallint,
	"film_grain" text,
	"film_hue" text,
	"monochrome_vignetting" text,
	"contrast" smallint,
	"sharpness" smallint,
	"highlights" smallint,
	"shadows" smallint,
	"midtones" smallint,
	"shading_effect" smallint DEFAULT 0 NOT NULL,
	"exposure_compensation" smallint DEFAULT 0 NOT NULL,
	"white_balance_2" text,
	"white_balance_temperature" integer,
	"white_balance_amber_offset" smallint,
	"white_balance_green_offset" smallint,
	"recipe_fingerprint" text,
	"mono_fingerprint" text,
	"mono_tone_fingerprint" text,
	"mono_no_wb_fingerprint" text
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "type" "recipe_type" DEFAULT 'COLOR' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_color_settings" ADD CONSTRAINT "recipe_color_settings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_mono_settings" ADD CONSTRAINT "recipe_mono_settings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_color_settings_recipe_id_unique" ON "recipe_color_settings" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_color_settings_recipe_fingerprint_idx" ON "recipe_color_settings" USING btree ("recipe_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_color_settings_color_fingerprint_idx" ON "recipe_color_settings" USING btree ("color_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_color_settings_color_tone_fingerprint_idx" ON "recipe_color_settings" USING btree ("color_tone_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_color_settings_no_wb_fingerprint_idx" ON "recipe_color_settings" USING btree ("no_wb_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_mono_settings_recipe_id_unique" ON "recipe_mono_settings" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_mono_settings_recipe_fingerprint_idx" ON "recipe_mono_settings" USING btree ("recipe_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_mono_settings_mono_fingerprint_idx" ON "recipe_mono_settings" USING btree ("mono_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_mono_settings_mono_tone_fingerprint_idx" ON "recipe_mono_settings" USING btree ("mono_tone_fingerprint");--> statement-breakpoint
CREATE INDEX "recipe_mono_settings_mono_no_wb_fingerprint_idx" ON "recipe_mono_settings" USING btree ("mono_no_wb_fingerprint");--> statement-breakpoint
CREATE INDEX "recipes_type_idx" ON "recipes" USING btree ("type");