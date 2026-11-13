import { migrate, type MigrationDriver } from "./migrate";

/**
 * Production schema bootstrap for a hosted Postgres (Supabase / Vercel Postgres).
 *
 * Runs the same journaled migrations as dev and tests (./migrate.ts) over a
 * direct postgres-js connection using the FULL connecting role (e.g. Supabase
 * `postgres`) — not the `app_user` role the request path drops to via
 * DB_LOCAL_ROLE, which cannot run DDL. Safe to call repeatedly: each migration
 * applies once, RLS and grants are re-applied idempotently, and a database that
 * predates the journal is baselined rather than re-migrated.
 *
 * Invoked by the protected /api/bootstrap route, which runs inside the Vercel
 * runtime where the database is reachable.
 */

export interface BootstrapResult {
  applied: string[];
  baselined: string[];
  tables: number;
}

export async function bootstrapProd(databaseUrl: string): Promise<BootstrapResult> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
  // A reserved connection, so BEGIN/COMMIT around each migration hold.
  const conn = await sql.reserve();
  try {
    const driver: MigrationDriver = {
      exec: async (text) => {
        await conn.unsafe(text);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows: async (text, params) => (await conn.unsafe(text, (params ?? []) as any[])) as any[],
    };
    const result = await migrate(driver);

    // Let the connecting role SET ROLE app_user (needed on Supabase, where the
    // app connects as `postgres`). Ignore if membership already exists.
    await conn.unsafe(`
      DO $$
      BEGIN
        EXECUTE format('GRANT app_user TO %I', current_user);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    const [t] = await conn.unsafe(
      `SELECT count(*)::int AS n FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    return { ...result, tables: Number(t?.n ?? 0) };
  } finally {
    conn.release();
    await sql.end({ timeout: 5 });
  }
}
