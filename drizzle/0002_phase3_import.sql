ALTER TABLE "records" ADD COLUMN "import_id" uuid;--> statement-breakpoint
CREATE INDEX "records_updated_idx" ON "records" USING btree ("workspace_id","object_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "records_import_idx" ON "records" USING btree ("workspace_id","import_id");