import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Journaled schema migrations, shared by every driver (AUDIT section 9:
 * "migrations run cleanly from empty to current and are safe to re-run").
 *
 * Each file in ./drizzle is applied at most once, inside its own transaction,
 * and recorded in `castellan_migrations`. rls.sql and the `app_user` grants are
 * idempotent and re-applied on every run, so a table added by a later migration
 * is brought under row-level security and granted to the app role
 * automatically.
 *
 * Databases created before the journal existed are baselined: a migration is
 * recorded as already applied when every table and column it creates is
 * present. Anything only partly present is NOT marked, and fails loudly when it
 * is applied, rather than being silently skipped.
 */

/** The minimum a driver must offer: run a script, and run a query for rows. */
export interface MigrationDriver {
  exec(sql: string): Promise<void>;
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface MigrationResult {
  applied: string[];
  baselined: string[];
}

const JOURNAL = `
  CREATE TABLE IF NOT EXISTS castellan_migrations (
    name text PRIMARY KEY,
    applied_at timestamp with time zone NOT NULL DEFAULT now(),
    baselined boolean NOT NULL DEFAULT false
  )`;

const APP_ROLE = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END $$;
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  -- The journal is the deployer's, not the application's.
  REVOKE ALL ON castellan_migrations FROM app_user;`;

function migrationsDir(): string {
  const dir = path.join(process.cwd(), "drizzle");
  if (!existsSync(dir)) throw new Error("No ./drizzle migrations found.");
  return dir;
}

export function migrationFiles(): string[] {
  const files = readdirSync(migrationsDir())
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  if (files.length === 0) throw new Error("No .sql migrations in ./drizzle.");
  return files;
}

/** Tables and added columns a migration creates (what "already applied" means). */
function createdObjects(sqlText: string) {
  const tables = [...sqlText.matchAll(/CREATE TABLE "([a-z_0-9]+)"/g)].map((m) => m[1]!);
  const columns = [...sqlText.matchAll(/ALTER TABLE "([a-z_0-9]+)" ADD COLUMN "([a-z_0-9]+)"/g)].map((m) => ({
    table: m[1]!,
    column: m[2]!,
  }));
  return { tables, columns };
}

async function alreadyPresent(db: MigrationDriver, sqlText: string): Promise<boolean> {
  const { tables, columns } = createdObjects(sqlText);
  if (tables.length === 0 && columns.length === 0) return false;
  for (const t of tables) {
    const [r] = await db.rows<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
    if (!r?.ok) return false;
  }
  for (const c of columns) {
    const [r] = await db.rows<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS ok`,
      [c.table, c.column],
    );
    if (!r?.ok) return false;
  }
  return true;
}

export async function migrate(db: MigrationDriver): Promise<MigrationResult> {
  await db.exec(JOURNAL);
  const done = new Set(
    (await db.rows<{ name: string }>(`SELECT name FROM castellan_migrations`)).map((r) => r.name),
  );
  const result: MigrationResult = { applied: [], baselined: [] };
  const dir = migrationsDir();

  // Baseline only a database that has a schema but no journal yet.
  const [legacy] = await db.rows<{ ok: boolean }>(
    `SELECT to_regclass('public.workspaces') IS NOT NULL AS ok`,
  );
  const baselining = done.size === 0 && Boolean(legacy?.ok);

  for (const file of migrationFiles()) {
    if (done.has(file)) continue;
    const sqlText = readFileSync(path.join(dir, file), "utf8");
    if (baselining && (await alreadyPresent(db, sqlText))) {
      await db.rows(`INSERT INTO castellan_migrations (name, baselined) VALUES ($1, true)`, [file]);
      result.baselined.push(file);
      continue;
    }
    // One transaction per migration: it lands completely or not at all.
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.exec("BEGIN");
    try {
      for (const stmt of statements) await db.exec(stmt);
      await db.rows(`INSERT INTO castellan_migrations (name) VALUES ($1)`, [file]);
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    result.applied.push(file);
  }

  // Idempotent: re-applied every run.
  await db.exec(readFileSync(path.join(process.cwd(), "src/server/db/rls.sql"), "utf8"));
  await db.exec(APP_ROLE);
  return result;
}
