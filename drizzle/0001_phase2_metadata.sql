CREATE TYPE "public"."field_type" AS ENUM('text', 'long_text', 'number', 'currency', 'percent', 'date', 'datetime', 'duration', 'boolean', 'single_select', 'multi_select', 'status', 'email', 'phone', 'url', 'address', 'person', 'relation', 'file', 'sensitive_text', 'auto_number');--> statement-breakpoint
CREATE TABLE "field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"api_name" text NOT NULL,
	"label" text NOT NULL,
	"type" "field_type" NOT NULL,
	"help_text" text,
	"config" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"unique" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"section" text,
	"position" integer DEFAULT 0 NOT NULL,
	"permissions" jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"api_name" text NOT NULL,
	"singular_label" text NOT NULL,
	"plural_label" text NOT NULL,
	"icon" text,
	"title_field_api_name" text,
	"description" text,
	"numbering_prefix" text,
	"numbering_seq" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "record_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source" text DEFAULT 'ui' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"workspace_id" uuid NOT NULL,
	"from_record_id" uuid NOT NULL,
	"field_api_name" text NOT NULL,
	"to_record_id" uuid NOT NULL,
	CONSTRAINT "record_links_from_record_id_field_api_name_to_record_id_pk" PRIMARY KEY("from_record_id","field_api_name","to_record_id")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"title" text,
	"status" text,
	"record_number" text,
	"owner_id" uuid,
	"team_id" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "field_defs" ADD CONSTRAINT "field_defs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_defs" ADD CONSTRAINT "field_defs_object_id_object_defs_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."object_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_defs" ADD CONSTRAINT "object_defs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_from_record_id_records_id_fk" FOREIGN KEY ("from_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_to_record_id_records_id_fk" FOREIGN KEY ("to_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_object_id_object_defs_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."object_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_defs_obj_api_unique" ON "field_defs" USING btree ("workspace_id","object_id","api_name");--> statement-breakpoint
CREATE INDEX "field_defs_object_idx" ON "field_defs" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_defs_ws_api_unique" ON "object_defs" USING btree ("workspace_id","api_name");--> statement-breakpoint
CREATE INDEX "object_defs_ws_idx" ON "object_defs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("workspace_id","processed_at");--> statement-breakpoint
CREATE INDEX "record_history_record_idx" ON "record_history" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE INDEX "record_links_ws_idx" ON "record_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "record_links_to_idx" ON "record_links" USING btree ("workspace_id","to_record_id");--> statement-breakpoint
CREATE INDEX "records_object_idx" ON "records" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "records_deleted_idx" ON "records" USING btree ("workspace_id","deleted_at");