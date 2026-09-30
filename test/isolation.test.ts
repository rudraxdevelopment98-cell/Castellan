import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { auditLog, memberships, teams, users, workspaces } from "@/server/db/schema";
import { asService, withWorkspace, type AnyPgDb } from "@/server/db/client";
import {
  acceptInvite,
  createTeam,
  createWorkspaceWithOwner,
  inviteMember,
  listMembers,
} from "@/server/tenancy";
import { verifyChain } from "@/server/audit";
import { PermissionError } from "@/server/rbac";

/**
 * The tenant-isolation suite (spec tenancy_model.isolation_must + acceptance
 * tests). Two workspaces with identical data; every access as a member of A must
 * return zero rows from B. Blocks deploy on failure.
 */

let db: AnyPgDb;
let pgClose: () => Promise<void>;

let userA: string;
let userB: string;
let userC: string;
let wsA: string;
let wsB: string;

async function insertUser(email: string): Promise<string> {
  return asService(db, async (tx) => {
    const [u] = await tx.insert(users).values({ email }).returning({ id: users.id });
    return u.id as string;
  });
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  pgClose = () => t.pg.close();

  userA = await insertUser("a@example.com");
  userB = await insertUser("b@example.com");
  userC = await insertUser("c@example.com");

  // Two workspaces with deliberately identical shape.
  wsA = (await createWorkspaceWithOwner(db, { ownerUserId: userA, name: "Alpha", slug: "alpha" })).workspaceId;
  wsB = (await createWorkspaceWithOwner(db, { ownerUserId: userB, name: "Beta", slug: "beta" })).workspaceId;

  await createTeam(db, { workspaceId: wsA, actorUserId: userA, name: "Ops" });
  await createTeam(db, { workspaceId: wsB, actorUserId: userB, name: "Ops" });
});

afterAll(async () => {
  await pgClose();
});

describe("tenant isolation", () => {
  it("a member of A sees only A's workspace row", async () => {
    const rows = (await withWorkspace(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.select().from(workspaces),
    )) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(wsA);
  });

  it("a member of A sees only A's memberships and teams", async () => {
    const [mems, tms] = await withWorkspace(db, { workspaceId: wsA, userId: userA }, async (tx) => [
      await tx.select().from(memberships),
      await tx.select().from(teams),
    ]);
    expect(mems.every((m: { workspaceId: string }) => m.workspaceId === wsA)).toBe(true);
    expect(tms.every((t: { workspaceId: string }) => t.workspaceId === wsB)).toBe(false);
    expect(tms.every((t: { workspaceId: string }) => t.workspaceId === wsA)).toBe(true);
  });

  it("explicitly querying B's rows while scoped to A returns nothing", async () => {
    const leaked = await withWorkspace(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.select().from(teams).where(eq(teams.workspaceId, wsB)),
    );
    expect(leaked).toHaveLength(0);
  });

  it("cannot insert a row into another workspace (WITH CHECK)", async () => {
    await expect(
      withWorkspace(db, { workspaceId: wsB, userId: userB }, (tx) =>
        tx.insert(teams).values({ workspaceId: wsA, name: "Sneaky" }),
      ),
    ).rejects.toThrow();
  });

  it("fails closed: no workspace scope set returns zero tenant rows", async () => {
    const rows = await db.transaction(async (tx: any) => {
      // Run as the app's non-superuser role, bypass off, but deliberately do
      // NOT set app.workspace_id — RLS must return nothing.
      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`select set_config('app.bypass','off',true)`);
      return tx.select().from(memberships);
    });
    expect(rows).toHaveLength(0);
  });

  it("audit rows never leak across workspaces and the chain verifies", async () => {
    const rowsA = (await withWorkspace(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.select().from(auditLog).orderBy(auditLog.at),
    )) as any[];
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r: { workspaceId: string | null }) => r.workspaceId === wsA)).toBe(true);
    expect(verifyChain(rowsA as any)).toBe(true);
  });
});

describe("membership & roles (acceptance: owner can invite a member with a role)", () => {
  it("owner invites, invitee accepts, and lands as the invited role", async () => {
    const { token } = await inviteMember(db, {
      workspaceId: wsA,
      actorUserId: userA,
      email: "c@example.com",
      role: "manager",
    });
    const res = await acceptInvite(db, { token, userId: userC });
    expect(res.workspaceId).toBe(wsA);
    expect(res.role).toBe("manager");

    const members = await listMembers(db, { workspaceId: wsA, actorUserId: userA });
    const c = members.find((m: { userId: string }) => m.userId === userC);
    expect(c?.role).toBe("manager");
    // and C shows up in A only
    expect(members.every((m: { userId: string }) => [userA, userC].includes(m.userId))).toBe(true);
  });

  it("a member without members.manage cannot invite", async () => {
    // Add a plain member to A, then have them try to invite.
    const { token } = await inviteMember(db, {
      workspaceId: wsA,
      actorUserId: userA,
      email: "d@example.com",
      role: "member",
    });
    const userD = await insertUser("d@example.com");
    await acceptInvite(db, { token, userId: userD });

    await expect(
      inviteMember(db, { workspaceId: wsA, actorUserId: userD, email: "e@example.com", role: "member" }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("a member of B cannot act on A even with A's ids", async () => {
    // userB is not a member of A -> actorRole throws before any write.
    await expect(
      createTeam(db, { workspaceId: wsA, actorUserId: userB, name: "X" }),
    ).rejects.toThrow();
  });
});
