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
