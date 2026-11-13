import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate, migrationFiles } from "@/server/db/migrate";
import { pgliteDriver } from "@/server/db/bootstrap";

/**
 * AUDIT section 9: migrations run cleanly from empty to current, are safe to
 * re-run, and a database created before the journal is baselined, not re-run.
 */

const tables = async (pg: PGlite) =>
  (
    await pg.query<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    )
  ).rows.map((r) => r.t);

const forcedRls = async (pg: PGlite) =>
  (
    await pg.query<{ t: string }>(
      `SELECT relname AS t FROM pg_class WHERE relforcerowsecurity AND relkind = 'r' ORDER BY 1`,
    )
  ).rows.map((r) => r.t);

describe("journaled migrations", () => {
  it("applies every migration to an empty database, then re-runs as a no-op", async () => {
    const pg = new PGlite();
    const first = await migrate(pgliteDriver(pg));
    expect(first.applied).toEqual(migrationFiles());
    expect(first.baselined).toEqual([]);
    expect(await tables(pg)).toEqual(expect.arrayContaining(["auth_tokens", "documents", "email_deliveries", "workspaces"]));

    const again = await migrate(pgliteDriver(pg));
    expect(again).toEqual({ applied: [], baselined: [] });
    await pg.close();
  });

  it("keeps every tenant table under forced row-level security after a re-run", async () => {
    const pg = new PGlite();
    await migrate(pgliteDriver(pg));
    await migrate(pgliteDriver(pg));
    const forced = await forcedRls(pg);
    for (const t of ["workspaces", "memberships", "records", "obligations", "documents", "audit_log"]) {
      expect(forced).toContain(t);
    }
    await pg.close();
  });

  it("baselines a pre-journal database and applies only what it lacks", async () => {
    const pg = new PGlite();
    // Simulate the live database: migrations 0000-0004 applied by the old
    // bootstrap, no journal table, nothing from 0005 yet.
    const files = migrationFiles();
    for (const f of files.slice(0, 5)) {
      const text = readFileSync(path.join(process.cwd(), "drizzle", f), "utf8");
      for (const stmt of text.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
    }
    const res = await migrate(pgliteDriver(pg));
    expect(res.baselined).toEqual(files.slice(0, 5));
    expect(res.applied).toEqual(files.slice(5));
    expect(await tables(pg)).toContain("auth_tokens");
    await pg.close();
  });

  it("a failing migration is rolled back completely and not recorded", async () => {
    const pg = new PGlite();
    await migrate(pgliteDriver(pg));
    // Forge a half-applied state: remove the journal entry for the last file
    // but keep its tables, then drop one of them. A re-run must not baseline it
    // (only partly present) and must fail loudly, leaving the journal unchanged.
    // The migration that creates email_deliveries (not simply the newest file).
    const last = migrationFiles().find((f) =>
      readFileSync(path.join(process.cwd(), "drizzle", f), "utf8").includes('CREATE TABLE "email_deliveries"'),
    )!;
    await pg.exec(`DELETE FROM castellan_migrations WHERE name = '${last}'`);
    await pg.exec(`DROP TABLE email_deliveries`);
    await expect(migrate(pgliteDriver(pg))).rejects.toThrow(/Migration .* failed/);
    const recorded = (await pg.query<{ name: string }>(`SELECT name FROM castellan_migrations`)).rows.map((r) => r.name);
    expect(recorded).not.toContain(last);
    await pg.close();
  });
});
