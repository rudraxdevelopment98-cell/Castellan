import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AnyPgDb } from "@/server/db/client";
import { applyMigrationsAndRls, ensureAppRole } from "@/server/db/bootstrap";

/**
 * In-process PGlite Postgres for tests. Applies the same migrations + rls.sql
 * that run on Supabase, then drops to a NOSUPERUSER role per transaction (via
 * DB_LOCAL_ROLE) so the real RLS policies are exercised.
 */
export async function makeTestDb(): Promise<{ pg: PGlite; db: AnyPgDb }> {
  const pg = new PGlite();
  await pg.waitReady;
  await applyMigrationsAndRls(pg);
  await ensureAppRole(pg);
  process.env.DB_LOCAL_ROLE = "app_user";
  const db = drizzle(pg) as unknown as AnyPgDb;
  return { pg, db };
}
