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

// --- Production driver (Supabase / any Postgres) ----------------------------
// Lazily created so the app boots without a DB during the v1 demo phase.

let _prodDb: AnyPgDb | null = null;

export async function getDb(): Promise<AnyPgDb> {
  if (_prodDb) return _prodDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const [{ drizzle }, postgresMod] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const client = postgresMod.default(url, { prepare: false });
  _prodDb = drizzle(client) as unknown as AnyPgDb;
  return _prodDb;
}
