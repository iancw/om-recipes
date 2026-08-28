CREATE TABLE "recipe_slug_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recipe_slug_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipe_id" integer NOT NULL,
	"slug" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_slug_aliases" ADD CONSTRAINT "recipe_slug_aliases_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_slug_aliases_slug_unique" ON "recipe_slug_aliases" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "recipe_slug_aliases_recipe_id_idx" ON "recipe_slug_aliases" USING btree ("recipe_id");