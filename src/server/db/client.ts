import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * The single query layer. ALL tenant data access goes through `withWorkspace`,
 * which opens a transaction and sets the `app.workspace_id` (and `app.user_id`)
 * GUCs so row-level security scopes every statement to one tenant. Service
 * operations (auth, workspace bootstrap, background jobs) use `asService`, which
 * turns on the `app.bypass` escape — and jobs still set a workspace explicitly.
 *
 * Because scope is enforced in the DATABASE (RLS), not just the app, a missing
 * or wrong filter in application code cannot leak another tenant's rows.
 */

export type AnyPgDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface ScopedCtx {
  workspaceId: string;
  userId?: string | null;
}

// The drizzle transaction handle carries both `.execute` and the query builders.
// Typed as `any` here only so the same helper works across the postgres-js and
// PGlite adapters; domain modules import table types for their own queries.
type Tx = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * In production the app already connects to Postgres as a non-superuser role, so
 * RLS applies directly. In the PGlite test harness the only role is a superuser
 * (which bypasses RLS), so tests set DB_LOCAL_ROLE to drop to a NOSUPERUSER role
 * per transaction and exercise the real policies. Empty when the env var is unset.
 */
function localRole(): string | null {
  const role = process.env.DB_LOCAL_ROLE;
  if (!role) return null;
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid DB_LOCAL_ROLE: ${role}`);
  return role;
}

/**
 * Apply the transaction's security context in ONE statement (one network round
 * trip) instead of one per setting. set_config(..., true) is transaction-local,
 * exactly like SET LOCAL. The role is set first so the tenant settings below it
 * are written by — and scoped to — the restricted role's transaction.
 */
async function applyContext(tx: Tx, settings: Array<[string, string]>): Promise<void> {
  const role = localRole();
  const all: Array<[string, string]> = role ? [["role", role], ...settings] : settings;
  const calls = all.map(([k, v]) => sql`set_config(${k}, ${v}, true)`);
  await tx.execute(sql`select ${sql.join(calls, sql`, `)}`);
}

/** Run `fn` scoped to one workspace. RLS filters every statement to it. */
export async function withWorkspace<T>(
  db: AnyPgDb,
  ctx: ScopedCtx,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await applyContext(tx, [
      ["app.bypass", "off"],
      ["app.workspace_id", ctx.workspaceId],
      ["app.user_id", ctx.userId ?? ""],
    ]);
    return fn(tx);
  });
}

/**
 * Service path: bypasses tenant RLS for auth, workspace creation and jobs.
 * Use sparingly and never with request-supplied workspace ids unchecked.
 */
export async function asService<T>(db: AnyPgDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await applyContext(tx, [["app.bypass", "on"]]);
    return fn(tx);
  });
}

// --- Drivers ----------------------------------------------------------------
// Production: postgres-js against Supabase (DATABASE_URL set), connecting as a
// non-superuser role subject to RLS. Local dev: a file-backed PGlite so the full
// platform runs with no external database, applying the same migrations + RLS.

let _db: AnyPgDb | null = null;
let _init: Promise<AnyPgDb> | null = null;

async function initProd(url: string): Promise<AnyPgDb> {
  const [{ drizzle }, postgresMod] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const client = postgresMod.default(url, { prepare: false });
  return drizzle(client) as unknown as AnyPgDb;
}

async function initDevPglite(): Promise<AnyPgDb> {
  const [{ PGlite }, { drizzle }, bootstrap] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("./bootstrap"),
  ]);
  const dir = process.env.CASTELLAN_DEV_DB_DIR || ".castellan-dev-db";
  const pg = new PGlite(dir);
  await pg.waitReady;
  // Idempotent and journaled: applies only migrations this database lacks.
  await bootstrap.applyMigrationsAndRls(pg);
  // PGlite's login role is a superuser, so drop to app_user per transaction.
  process.env.DB_LOCAL_ROLE = "app_user";
  return drizzle(pg) as unknown as AnyPgDb;
}

/** Point getDb() at a specific database (tests only). */
export function _setDbForTests(db: AnyPgDb | null): void {
  _db = db;
  _init = null;
}

/** Whether a hosted Postgres is configured (used to gate accounts in prod). */
export function hasDatabase(): boolean {
  if (_db) return true;
  if (process.env.NODE_ENV !== "production") return true; // dev uses PGlite
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING,
  );
}

/** The application database. Supabase in prod, PGlite for local dev. */
export async function getDb(): Promise<AnyPgDb> {
  if (_db) return _db;
  if (_init) return _init;
  // Accept the common hosted-Postgres env var names (Supabase / Vercel Postgres).
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  _init = (url ? initProd(url) : initDevPglite()).then((db) => {
    _db = db;
    return db;
  });
  return _init;
}
