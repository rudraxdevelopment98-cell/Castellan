import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Shared schema/RLS bootstrap for PGlite (tests and local dev). Applies the
 * generated Drizzle migrations, then rls.sql, then creates the NOSUPERUSER
 * `app_user` role the query layer drops to (PGlite's only login role is a
 * superuser, which would otherwise bypass RLS). On Supabase none of this runs —
 * migrations go through drizzle-kit and the app connects as a non-superuser.
 */

// pg is a PGlite instance (has .exec).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyMigrationsAndRls(pg: any): Promise<void> {
  const migrationsDir = path.join(process.cwd(), "drizzle");
  if (!existsSync(migrationsDir)) {
    throw new Error("No ./drizzle migrations found. Run `npm run db:generate`.");
  }
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    throw new Error("No .sql migrations in ./drizzle. Run `npm run db:generate`.");
  }
  for (const file of files) {
    const raw = readFileSync(path.join(migrationsDir, file), "utf8");
    for (const stmt of raw.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await pg.exec(s);
    }
  }
  const rls = readFileSync(path.join(process.cwd(), "src/server/db/rls.sql"), "utf8");
  await pg.exec(rls);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureAppRole(pg: any): Promise<void> {
  // Idempotent: safe to call on a persistent dev database that already has it.
  await pg.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  `);
}

/** True once the core tables exist (so dev bootstrap runs only on a fresh DB). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isBootstrapped(pg: any): Promise<boolean> {
  const res = await pg.query(
    `SELECT to_regclass('public.workspaces') IS NOT NULL AS ok`,
  );
  return Boolean(res?.rows?.[0]?.ok);
}
