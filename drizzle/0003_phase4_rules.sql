CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"title" text NOT NULL,
	"why" text,
	"category" text DEFAULT 'General' NOT NULL,
	"due_date" text,
	"cycle_key" text NOT NULL,
	"planned_date" text,
	"reminder_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"snooze_reason" text,
	"snoozed_until" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"why" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"applies_when" jsonb,
	"trigger_field" text NOT NULL,
	"cadence" jsonb NOT NULL,
	"reminder_ladder" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"source_note" text,
	"last_verified" text,
	"needs_verification" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_object_id_object_defs_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."object_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "obligations_dedupe_unique" ON "obligations" USING btree ("workspace_id","rule_id","record_id","cycle_key");--> statement-breakpoint
CREATE INDEX "obligations_ws_idx" ON "obligations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "obligations_due_idx" ON "obligations" USING btree ("workspace_id","due_date");--> statement-breakpoint
CREATE INDEX "rules_ws_idx" ON "rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "rules_object_idx" ON "rules" USING btree ("workspace_id","object_id");