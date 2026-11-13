import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { invitations, memberships } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { acceptInvite, createWorkspaceWithOwner, inviteMember, listMembers } from "@/server/tenancy";
import { canGrantRole, PermissionError, type Role } from "@/server/rbac";

/**
 * AUDIT H3/H4: an invitation only works for the address it was sent to, exactly
 * once, before it expires — and can never hand out a role above the inviter's.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let ws: string;
let owner: string;
let admin: string;

async function user(email: string): Promise<string> {
  const u = await createUser({ email, password: "a-strong-password", name: email }, { emailVerified: true });
  if (!u.ok) throw new Error("user setup");
  return u.user.id;
}

const invite = (actorUserId: string, email: string, role: Role) =>
  inviteMember(db, { workspaceId: ws, actorUserId, email, role });

const isMember = async (userId: string) =>
  (await listMembers(db, { workspaceId: ws, actorUserId: owner })).some((m: { userId: string }) => m.userId === userId);

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
  owner = await user("owner@invite.test");
  admin = await user("admin@invite.test");
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Invite WS", slug: "invite" })).workspaceId;
  await asService(db, (tx) => tx.insert(memberships).values({ workspaceId: ws, userId: admin, role: "admin", scopeType: "all" }));
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("invitations are bound to the invited email (AUDIT H3)", () => {
  it("a different signed-in user cannot accept someone else's invite", async () => {
    const { token } = await invite(owner, "intended@invite.test", "member");
    const intruder = await user("intruder@invite.test");
    await expect(acceptInvite(db, { token, userId: intruder })).rejects.toThrow(/invalid or has expired/i);
    expect(await isMember(intruder)).toBe(false);

    // The failed attempt must not burn the invite for its real recipient.
    const intended = await user("intended@invite.test");
    const res = await acceptInvite(db, { token, userId: intended });
    expect(res.role).toBe("member");
    expect(await isMember(intended)).toBe(true);
  });

  it("matching is case- and whitespace-insensitive on the invited address", async () => {
    const { token } = await invite(owner, "  Mixed.Case@Invite.Test ", "viewer");
    const u = await user("mixed.case@invite.test");
    expect((await acceptInvite(db, { token, userId: u })).role).toBe("viewer");
  });

  it("an invite cannot be used twice", async () => {
    const { token } = await invite(owner, "once@invite.test", "member");
    const u = await user("once@invite.test");
    await acceptInvite(db, { token, userId: u });
    await expect(acceptInvite(db, { token, userId: u })).rejects.toThrow(/invalid or has expired/i);
  });

  it("an expired invite is rejected", async () => {
    const { token, invitationId } = await invite(owner, "late@invite.test", "member");
    await asService(db, (tx) =>
      tx.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, invitationId)),
    );
    const u = await user("late@invite.test");
    await expect(acceptInvite(db, { token, userId: u })).rejects.toThrow(/invalid or has expired/i);
    expect(await isMember(u)).toBe(false);
  });

  it("a tampered token is rejected", async () => {
    const { token } = await invite(owner, "tamper@invite.test", "member");
    const u = await user("tamper@invite.test");
    const bad = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    await expect(acceptInvite(db, { token: bad, userId: u })).rejects.toThrow(/invalid or has expired/i);
  });
});

describe("no privilege escalation through invites (AUDIT H4)", () => {
  it("nobody can invite an owner — not even the owner", async () => {
    await expect(invite(admin, "new-owner-1@invite.test", "owner")).rejects.toBeInstanceOf(PermissionError);
    await expect(invite(owner, "new-owner-2@invite.test", "owner")).rejects.toBeInstanceOf(PermissionError);
  });

  it("an admin can invite up to admin", async () => {
    await expect(invite(admin, "peer@invite.test", "admin")).resolves.toBeTruthy();
    await expect(invite(admin, "staff@invite.test", "member")).resolves.toBeTruthy();
  });

  it("canGrantRole never grants above the actor's own rank", () => {
    const roles: Role[] = ["guest", "viewer", "member", "manager", "admin", "owner"];
    for (const actor of roles) {
      for (const target of roles) {
        const allowed = canGrantRole(actor, target);
        if (target === "owner") expect(allowed).toBe(false);
        else expect(allowed).toBe(roles.indexOf(target) <= roles.indexOf(actor));
      }
    }
  });
});
