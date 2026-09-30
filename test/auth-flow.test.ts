import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, type AnyPgDb } from "@/server/db/client";
import { createUser, verifyLogin } from "@/server/users";
import { createSession, resolveSession, revokeSession } from "@/server/sessionStore";
import { getMembershipsForUser, resolveWorkspaceForUser, uniqueWorkspaceSlug } from "@/server/context";
import { createWorkspaceWithOwner, inviteMember, acceptInvite } from "@/server/tenancy";

/**
 * End-to-end Phase 1 flow at the domain layer (what the UI + session middleware
 * call): sign up -> sign in -> session -> create workspace -> invite -> accept.
 * The React pages are thin wrappers over these tested functions.
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

describe("auth flow", () => {
  it("signs up, rejects duplicate email, and signs in", async () => {
    const created = await createUser({ email: "Owner@Example.com", password: "correct horse staple", name: "Owner" });
    expect(created.ok).toBe(true);

    const dup = await createUser({ email: "owner@example.com", password: "another one here", name: "Dup" });
    expect(dup.ok).toBe(false);

    const bad = await verifyLogin({ email: "owner@example.com", password: "wrong" });
    expect(bad.ok).toBe(false);

    const good = await verifyLogin({ email: "owner@example.com", password: "correct horse staple" });
    expect(good.ok).toBe(true);
  });

  it("locks the account after repeated failures", async () => {
    await createUser({ email: "lock@example.com", password: "right password here", name: "Lock" });
    for (let i = 0; i < 5; i++) {
      await verifyLogin({ email: "lock@example.com", password: "nope" });
    }
    const res = await verifyLogin({ email: "lock@example.com", password: "right password here" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/locked/i);
  });

  it("creates and resolves a session, then revokes it", async () => {
    const u = await createUser({ email: "sess@example.com", password: "session password ok", name: "Sess" });
    if (!u.ok) throw new Error("setup");
    const { token } = await createSession(u.user.id);
    const resolved = await resolveSession(token);
    expect(resolved?.user.email).toBe("sess@example.com");
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
    expect(await resolveSession("garbage")).toBeNull();
  });
});

describe("workspace onboarding + membership", () => {
  it("owner creates a workspace, invites, invitee accepts with role", async () => {
    const owner = await createUser({ email: "o2@example.com", password: "owner pass here ok", name: "O2" });
    const invitee = await createUser({ email: "m2@example.com", password: "member pass here ok", name: "M2" });
    if (!owner.ok || !invitee.ok) throw new Error("setup");

    const slug = await uniqueWorkspaceSlug("acme");
    const { workspaceId } = await createWorkspaceWithOwner(db, {
      ownerUserId: owner.user.id,
      name: "Acme",
      slug,
    });

    const ownerWss = await getMembershipsForUser(owner.user.id);
    expect(ownerWss.map((w) => w.workspaceId)).toContain(workspaceId);
    expect(ownerWss.find((w) => w.workspaceId === workspaceId)?.role).toBe("owner");

    const { token } = await inviteMember(db, {
      workspaceId,
      actorUserId: owner.user.id,
      email: "m2@example.com",
      role: "manager",
    });
    const accepted = await acceptInvite(db, { token, userId: invitee.user.id });
    expect(accepted.role).toBe("manager");

    const membership = await resolveWorkspaceForUser(invitee.user.id, slug);
    expect(membership?.role).toBe("manager");
    // A non-member resolves to null.
    const owner3 = await createUser({ email: "x2@example.com", password: "xxxx pass here ok", name: "X2" });
    if (!owner3.ok) throw new Error("setup");
    expect(await resolveWorkspaceForUser(owner3.user.id, slug)).toBeNull();
  });

  it("unique slug helper avoids collisions", async () => {
    const u = await createUser({ email: "slug@example.com", password: "slug pass here ok", name: "S" });
    if (!u.ok) throw new Error("setup");
    const s1 = await uniqueWorkspaceSlug("dupe");
    await createWorkspaceWithOwner(db, { ownerUserId: u.user.id, name: "Dupe", slug: s1 });
    const s2 = await uniqueWorkspaceSlug("dupe");
    expect(s2).not.toBe(s1);
  });
});
