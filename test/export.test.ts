import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord } from "@/server/records";
import { exportCsv } from "@/server/export";
import { PermissionError, type Role } from "@/server/rbac";

/**
 * AUDIT H2: CSV export requires `records.export`, and a scope-restricted
 * exporter only receives rows in their scope.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let ws: string;
let owner: string;
let objectId: string;
type Fields = NonNullable<Awaited<ReturnType<typeof getObjectByApiName>>>["fields"];
let fields: Fields;
const users: Partial<Record<string, string>> = {};

async function addUser(key: string, role: Role, scopeType: "all" | "assigned") {
  const u = await createUser({ email: `${key}@export.test`, password: "a-strong-password", name: key });
  if (!u.ok) throw new Error("user setup");
  users[key] = u.user.id;
  await asService(db, (tx) => tx.insert(memberships).values({ workspaceId: ws, userId: u.user.id, role, scopeType }));
}

const run = (key: string) =>
  exportCsv(db, { workspaceId: ws, actorUserId: key === "owner" ? owner : users[key]!, objectId, fields });

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
  const o = await createUser({ email: "owner@export.test", password: "a-strong-password", name: "Owner" }, { emailVerified: true });
  if (!o.ok) throw new Error("owner setup");
  owner = o.user.id;
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Export WS", slug: "export" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "uk-landlord", withSamples: false });
  const obj = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" }))!;
  objectId = obj.id;
  fields = obj.fields;

  await addUser("admin", "admin", "all");
  await addUser("manager", "manager", "all");
  await addUser("scopedManager", "manager", "assigned");
  await addUser("member", "member", "all");
  await addUser("viewer", "viewer", "all");
  await addUser("guest", "guest", "all");

  await createRecord(db, { workspaceId: ws, actorUserId: owner, objectId, input: { name: "Owner House" } });
  await createRecord(db, {
    workspaceId: ws, actorUserId: owner, objectId, input: { name: "Scoped House" }, ownerId: users.scopedManager,
  });
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("CSV export authorisation (AUDIT H2)", () => {
  it.each(["owner", "admin", "manager"])("%s may export", async (key) => {
    const csv = await run(key);
    expect(csv).toContain("Owner House");
    expect(csv).toContain("Scoped House");
  });

  it.each(["member", "viewer", "guest"])("%s may not export", async (key) => {
    await expect(run(key)).rejects.toBeInstanceOf(PermissionError);
  });

  it("a scope-restricted exporter only receives rows in scope", async () => {
    const csv = await run("scopedManager");
    expect(csv).toContain("Scoped House");
    expect(csv).not.toContain("Owner House");
  });
});
