import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * One-time production bootstrap for a hosted Postgres (Supabase / Vercel Postgres).
 *
 * The local dev / test path (bootstrap.ts) runs against PGlite with its own API.
 * In production the schema is applied here, over a direct postgres-js connection,
 * because it must run with the FULL connecting role (e.g. Supabase `postgres`) —
 * not the `app_user` role the request path drops to via DB_LOCAL_ROLE, which
 * cannot CREATE ROLE / CREATE TABLE.
 *
 * Steps (idempotent — safe to call more than once):
 *   1. Apply the generated Drizzle migrations (./drizzle/*.sql), then rls.sql,
 *      but only if the schema is not already present.
 *   2. Create the NOSUPERUSER / NOBYPASSRLS `app_user` role and grant it DML on
 *      the tenant tables, so FORCE ROW LEVEL SECURITY actually constrains the
 *      app (the default Supabase `postgres` role would otherwise bypass RLS).
 *   3. Grant `app_user` to the connecting role so the request path can
 *      `SET LOCAL ROLE app_user` per transaction.
 *
 * This is invoked by the protected /api/bootstrap route, which runs inside the
 * Vercel runtime (where the database is reachable) rather than from a developer
 * machine.
 */

export interface BootstrapResult {
  migrationsApplied: boolean;
  appRoleEnsured: boolean;
  tables: number;
}

// postgres-js executes a multi-statement string with the simple query protocol
// when called via `unsafe` without parameters, so each migration file (whose
// `--> statement-breakpoint` markers are SQL line comments) runs as one call.
export async function bootstrapProd(databaseUrl: string): Promise<BootstrapResult> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const already = await isBootstrapped(sql);
    if (!already) {
      const dir = path.join(process.cwd(), "drizzle");
      if (!existsSync(dir)) throw new Error("No ./drizzle migrations found.");
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      if (files.length === 0) throw new Error("No .sql migrations in ./drizzle.");
      for (const file of files) {
        const ddl = readFileSync(path.join(dir, file), "utf8");
        await sql.unsafe(ddl);
      }
      const rls = readFileSync(
        path.join(process.cwd(), "src/server/db/rls.sql"),
        "utf8",
      );
      await sql.unsafe(rls);
    }

    // Incremental, idempotent additions for an already-bootstrapped database
    // (tables added after the first bootstrap). Safe to run every time.
    await ensureAdditions(sql);

    // The non-bypass role the request path drops to. Idempotent.
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_user;
    `);

    // Let the connecting role SET ROLE app_user (needed on Supabase, where the
    // app connects as `postgres`). Ignore if membership already exists.
    await sql.unsafe(`
      DO $$
      BEGIN
        EXECUTE format('GRANT app_user TO %I', current_user);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    const tables = await countTenantTables(sql);
    return { migrationsApplied: !already, appRoleEnsured: true, tables };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Idempotent DDL for tables introduced after the first bootstrap. Each statement
// is guarded (IF NOT EXISTS / policy existence check) so re-running is a no-op.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAdditions(sql: any): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_id uuid REFERENCES records(id) ON DELETE SET NULL,
      object_api_name text,
      title text,
      filename text NOT NULL,
      mime text NOT NULL,
      size integer NOT NULL,
      bytes bytea NOT NULL,
      doc_type text,
      key_date text,
      reminder_days jsonb NOT NULL DEFAULT '[30,7,1]'::jsonb,
      note text,
      uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      deleted_at timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS documents_ws_idx ON documents USING btree (workspace_id, deleted_at);
    CREATE INDEX IF NOT EXISTS documents_record_idx ON documents USING btree (workspace_id, record_id);
    CREATE INDEX IF NOT EXISTS documents_keydate_idx ON documents USING btree (workspace_id, key_date);
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE documents FORCE ROW LEVEL SECURITY;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'documents' AND policyname = 'documents_tenant'
      ) THEN
        CREATE POLICY documents_tenant ON documents
          USING (
            workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
            OR current_setting('app.bypass', true) = 'on'
          )
          WITH CHECK (
            workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
            OR current_setting('app.bypass', true) = 'on'
          );
      END IF;
    END $$;
  `);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isBootstrapped(sql: any): Promise<boolean> {
  const rows = await sql.unsafe(
    `SELECT to_regclass('public.workspaces') IS NOT NULL AS ok`,
  );
  return Boolean(rows?.[0]?.ok);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countTenantTables(sql: any): Promise<number> {
  const rows = await sql.unsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return Number(rows?.[0]?.n ?? 0);
}
