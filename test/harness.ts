import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AnyPgDb } from "@/server/db/client";

/**
 * Spins up an in-process PGlite Postgres, applies the generated Drizzle
 * migrations, then applies rls.sql. Same SQL that runs on Supabase, so the
 * isolation guarantees proven here hold in production. PGlite runs as superuser,
 * which is why rls.sql uses FORCE ROW LEVEL SECURITY.
 */
export async function makeTestDb(): Promise<{ pg: PGlite; db: AnyPgDb }> {
  const pg = new PGlite();
  const db = drizzle(pg) as unknown as AnyPgDb;

  const migrationsDir = path.join(process.cwd(), "drizzle");
  if (!existsSync(migrationsDir)) {
    throw new Error(
      "No ./drizzle migrations found. Run `npm run db:generate` first.",
    );
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
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

  const rls = readFileSync(
    path.join(process.cwd(), "src/server/db/rls.sql"),
    "utf8",
  );
  await pg.exec(rls);

  // PGlite's only role is a superuser, which bypasses RLS. Create a NOSUPERUSER
  // role with table privileges; the query layer drops to it per transaction
  // (via DB_LOCAL_ROLE) so the tests exercise the real policies — as the app
  // does against Supabase, where it already connects as a non-superuser.
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  `);
  process.env.DB_LOCAL_ROLE = "app_user";

  return { pg, db };
}
