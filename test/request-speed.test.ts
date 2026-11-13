import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, withWorkspace, type AnyPgDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createSession, resolveSession, LAST_SEEN_WRITE_MS } from "@/server/sessionStore";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { resolveWorkspaceForUser } from "@/server/context";

/**
 * Request-speed changes must not weaken isolation: the single-statement
 * transaction setup still drops to the restricted role and sets every tenant
 * setting, and the throttled last-seen write still happens when it is stale.
 */

let db: AnyPgDb;
let close: () => Promise<void>;

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? (r as Row[]));

describe("transaction context in one statement", () => {
  it("withWorkspace runs as the restricted role with every tenant setting applied", async () => {
    const ws = "11111111-1111-4111-8111-111111111111";
    const uid = "22222222-2222-4222-8222-222222222222";
    const got = await withWorkspace(db, { workspaceId: ws, userId: uid }, async (tx) =>
      rowsOf(
        await tx.execute(
          sql`select current_user as u, current_setting('app.workspace_id') as w,
                     current_setting('app.user_id') as id, current_setting('app.bypass') as b`,
        ),
      )[0],
    );
    expect(got).toMatchObject({ u: "app_user", w: ws, id: uid, b: "off" });
  });

  it("asService runs as the restricted role with bypass on", async () => {
    const got = await asService(db, async (tx) =>
      rowsOf(await tx.execute(sql`select current_user as u, current_setting('app.bypass') as b`))[0],
    );
    expect(got).toMatchObject({ u: "app_user", b: "on" });
  });

  it("settings do not leak past the transaction", async () => {
    await withWorkspace(db, { workspaceId: "11111111-1111-4111-8111-111111111111" }, async () => null);
    const after = await asService(db, async (tx) =>
      rowsOf(await tx.execute(sql`select current_setting('app.workspace_id', true) as w`))[0],
    );
    expect(after?.w ?? "").toBe("");
  });

  it("rejects an unsafe role name", async () => {
    const prev = process.env.DB_LOCAL_ROLE;
    process.env.DB_LOCAL_ROLE = "app_user; drop table users";
    try {
      await expect(asService(db, async () => null)).rejects.toThrow(/Invalid DB_LOCAL_ROLE/);
    } finally {
      process.env.DB_LOCAL_ROLE = prev;
    }
  });
});

describe("last-seen throttle", () => {
  it("writes last_seen_at only when it is stale", async () => {
    const u = await createUser({ email: "seen@example.com", password: "seen password ok", name: "Seen" }, { emailVerified: true });
    if (!u.ok) throw new Error("setup");
    const { token, sessionId } = await createSession(u.user.id);
    const read = async () =>
      asService(db, async (tx) => {
        const [r] = await tx.select({ t: sessions.lastSeenAt }).from(sessions).where(eq(sessions.id, sessionId));
        return r?.t ? new Date(r.t as Date).getTime() : 0;
      });
    const set = async (ms: number) =>
      asService(db, async (tx) => tx.update(sessions).set({ lastSeenAt: new Date(ms) }).where(eq(sessions.id, sessionId)));

    // Fresh: a request does not rewrite it.
    const fresh = Date.now() - 1000;
    await set(fresh);
    expect(await resolveSession(token)).not.toBeNull();
    expect(Math.abs((await read()) - fresh)).toBeLessThan(1000);

    // Stale: a request refreshes it.
    const stale = Date.now() - LAST_SEEN_WRITE_MS - 60_000;
    await set(stale);
    expect(await resolveSession(token)).not.toBeNull();
    expect((await read()) - stale).toBeGreaterThan(LAST_SEEN_WRITE_MS);
  });
});

describe("workspace resolution carries its security policy", () => {
  it("reports mfaRequired from the workspace policy", async () => {
    const u = await createUser({ email: "pol@example.com", password: "policy password ok", name: "Pol" }, { emailVerified: true });
    if (!u.ok) throw new Error("setup");
    const ws = await createWorkspaceWithOwner(db, { name: "Policy WS", slug: "policy-ws", ownerUserId: u.user.id });
    const before = await resolveWorkspaceForUser(u.user.id, "policy-ws");
    expect(before?.mfaRequired).toBe(false);
    await asService(db, async (tx) =>
      tx.execute(sql`update workspaces set security_policy = '{"mfaRequired": true}'::jsonb where id = ${ws.workspaceId}`),
    );
    const after = await resolveWorkspaceForUser(u.user.id, "policy-ws");
    expect(after?.mfaRequired).toBe(true);
  });
});
