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

async function setLocal(tx: Tx, key: string, value: string): Promise<void> {
  // set_config(key, value, is_local=true) => scoped to this transaction only.
  await tx.execute(sql`select set_config(${key}, ${value}, true)`);
}

/**
 * In production the app already connects to Postgres as a non-superuser role, so
 * RLS applies directly. In the PGlite test harness the only role is a superuser
 * (which bypasses RLS), so tests set DB_LOCAL_ROLE to drop to a NOSUPERUSER role
 * per transaction and exercise the real policies. No-op when the env var is unset.
 */
async function applyLocalRole(tx: Tx): Promise<void> {
  const role = process.env.DB_LOCAL_ROLE;
  if (!role) return;
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid DB_LOCAL_ROLE: ${role}`);
  await tx.execute(sql`set local role ${sql.identifier(role)}`);
}

/** Run `fn` scoped to one workspace. RLS filters every statement to it. */
export async function withWorkspace<T>(
  db: AnyPgDb,
  ctx: ScopedCtx,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await applyLocalRole(tx);
    await setLocal(tx, "app.bypass", "off");
    await setLocal(tx, "app.workspace_id", ctx.workspaceId);
    await setLocal(tx, "app.user_id", ctx.userId ?? "");
    return fn(tx);
  });
}

/**
 * Service path: bypasses tenant RLS for auth, workspace creation and jobs.
 * Use sparingly and never with request-supplied workspace ids unchecked.
 */
export async function asService<T>(db: AnyPgDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await applyLocalRole(tx);
    await setLocal(tx, "app.bypass", "on");
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
  if (!(await bootstrap.isBootstrapped(pg))) {
    await bootstrap.applyMigrationsAndRls(pg);
  }
  await bootstrap.ensureAppRole(pg);
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
