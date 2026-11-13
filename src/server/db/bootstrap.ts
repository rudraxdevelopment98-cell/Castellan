import { migrate, type MigrationDriver, type MigrationResult } from "./migrate";

/**
 * Schema bootstrap for PGlite (tests and local dev). Uses the same journaled
 * runner as production (./migrate.ts), so dev and test databases go through
 * exactly the migrations, RLS policies and app role that Supabase does.
 * PGlite's only login role is a superuser, which would bypass RLS, so the
 * query layer drops to the NOSUPERUSER `app_user` role per transaction.
 */

// pg is a PGlite instance (has .exec and .query).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pgliteDriver(pg: any): MigrationDriver {
  return {
    exec: async (sql) => {
      await pg.exec(sql);
    },
    rows: async (sql, params) => (await pg.query(sql, params ?? [])).rows,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyMigrationsAndRls(pg: any): Promise<MigrationResult> {
  return migrate(pgliteDriver(pg));
}

/** Kept for callers that only need the role; migrate() already ensures it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureAppRole(pg: any): Promise<void> {
  await migrate(pgliteDriver(pg));
}
