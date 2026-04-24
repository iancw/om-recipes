CREATE TABLE "privacy_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "privacy_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"subject_user_uuid" uuid NOT NULL,
	"request_type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"artifact_key" text,
	"artifact_content_type" text,
	"artifact_file_name" text,
	"artifact_size_bytes" integer,
	"artifact_expires_at" timestamp with time zone,
	"failure_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_user_id_idx" ON "privacy_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_subject_user_uuid_idx" ON "privacy_requests" USING btree ("subject_user_uuid");--> statement-breakpoint
CREATE INDEX "privacy_requests_type_status_idx" ON "privacy_requests" USING btree ("request_type","status");--> statement-breakpoint
CREATE INDEX "privacy_requests_created_at_idx" ON "privacy_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_user_request_type_inflight_unique" ON "privacy_requests" USING btree ("user_id","request_type") WHERE "privacy_requests"."user_id" is not null and "privacy_requests"."status" in ('pending', 'processing');