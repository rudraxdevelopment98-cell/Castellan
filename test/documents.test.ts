import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord } from "@/server/records";
import {
  createDocument,
  getDocumentBytes,
  listDocuments,
  softDeleteDocument,
  updateDocumentMeta,
} from "@/server/documents";
import { PermissionError, type Role } from "@/server/rbac";

/**
 * AUDIT H12: documents carry capability checks and honour record scope, and no
 * document id reaches across workspaces.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let ws: string;
let otherWs: string;
let owner: string;
let outsider: string; // owner of a different workspace
let viewer: string; // role viewer, scope all
let member: string; // role member, scope assigned
let scopedAdmin: string; // role admin, scope assigned
let recOwner: string;
let recMember: string;
let docOnOwnerRecord: string;
let docOnMemberRecord: string;
let docLooseByOwner: string;

const pdf = Buffer.from("%PDF-1.4 test");

async function user(email: string): Promise<string> {
  const u = await createUser({ email, password: "a-strong-password", name: email });
  if (!u.ok) throw new Error("user setup");
  return u.user.id;
}

async function addMember(userId: string, role: Role, scopeType: "all" | "assigned") {
  await asService(db, (tx) => tx.insert(memberships).values({ workspaceId: ws, userId, role, scopeType }));
}

async function upload(actorUserId: string, filename: string, recordId?: string) {
  return createDocument(db, { workspaceId: ws, actorUserId, filename, mime: "application/pdf", bytes: pdf, recordId });
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);

  owner = await user("owner@docs.test");
  outsider = await user("outsider@docs.test");
  viewer = await user("viewer@docs.test");
  member = await user("member@docs.test");
  scopedAdmin = await user("scoped-admin@docs.test");

  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Docs WS", slug: "docs" })).workspaceId;
  otherWs = (await createWorkspaceWithOwner(db, { ownerUserId: outsider, name: "Other WS", slug: "other" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "uk-landlord", withSamples: false });
  const objectId = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" }))!.id;

  await addMember(viewer, "viewer", "all");
  await addMember(member, "member", "assigned");
  await addMember(scopedAdmin, "admin", "assigned");

  const mk = async (ownerId: string, name: string) => {
    const r = await createRecord(db, { workspaceId: ws, actorUserId: owner, objectId, input: { name }, ownerId });
    if (!r.ok) throw new Error("record setup");
    return r.recordId;
  };
  recOwner = await mk(owner, "Owner House");
  recMember = await mk(member, "Member House");

  const id = async (p: ReturnType<typeof upload>) => {
    const r = await p;
    if (!r.ok) throw new Error("doc setup: " + r.error);
    return r.id;
  };
  docOnOwnerRecord = await id(upload(owner, "owner-policy.pdf", recOwner));
  docOnMemberRecord = await id(upload(owner, "member-policy.pdf", recMember));
  docLooseByOwner = await id(upload(owner, "loose.pdf"));
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("document capabilities (AUDIT H12)", () => {
  it("a viewer cannot upload", async () => {
    await expect(upload(viewer, "nope.pdf")).rejects.toBeInstanceOf(PermissionError);
  });

  it("a viewer cannot edit or remove a document", async () => {
    await expect(
      updateDocumentMeta(db, { workspaceId: ws, actorUserId: viewer, id: docLooseByOwner, title: "x" }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      softDeleteDocument(db, { workspaceId: ws, actorUserId: viewer, id: docLooseByOwner }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("a member can upload but cannot remove", async () => {
    const res = await upload(member, "mine.pdf", recMember);
    expect(res.ok).toBe(true);
    await expect(
      softDeleteDocument(db, { workspaceId: ws, actorUserId: member, id: docOnMemberRecord }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("document record scope (AUDIT H12)", () => {
  it("owner (scope 'all') sees every document", async () => {
    const docs = await listDocuments(db, { workspaceId: ws, actorUserId: owner });
    expect(docs.length).toBeGreaterThanOrEqual(3);
  });

  it("a scoped member lists only documents on their records or their own loose uploads", async () => {
    const docs = await listDocuments(db, { workspaceId: ws, actorUserId: member });
    const ids = docs.map((d) => d.id);
    expect(ids).toContain(docOnMemberRecord);
    expect(ids).not.toContain(docOnOwnerRecord);
    expect(ids).not.toContain(docLooseByOwner);
  });

  it("a scoped member cannot download an out-of-scope document by id", async () => {
    expect(await getDocumentBytes(db, { workspaceId: ws, actorUserId: member, id: docOnOwnerRecord })).toBeNull();
    expect(await getDocumentBytes(db, { workspaceId: ws, actorUserId: member, id: docLooseByOwner })).toBeNull();
    expect(await getDocumentBytes(db, { workspaceId: ws, actorUserId: member, id: docOnMemberRecord })).not.toBeNull();
  });

  it("a scoped member cannot attach a document to a record outside their scope", async () => {
    const res = await upload(member, "sneaky.pdf", recOwner);
    expect(res.ok).toBe(false);
  });

  it("a scoped admin cannot edit or remove an out-of-scope document", async () => {
    expect(
      (await updateDocumentMeta(db, { workspaceId: ws, actorUserId: scopedAdmin, id: docOnOwnerRecord, title: "x" })).ok,
    ).toBe(false);
    expect((await softDeleteDocument(db, { workspaceId: ws, actorUserId: scopedAdmin, id: docOnOwnerRecord })).ok).toBe(false);
    // still there for the owner
    expect(await getDocumentBytes(db, { workspaceId: ws, actorUserId: owner, id: docOnOwnerRecord })).not.toBeNull();
  });
});

describe("document tenant isolation", () => {
  it("another workspace's owner cannot list, download, edit or remove these documents", async () => {
    expect(await listDocuments(db, { workspaceId: otherWs, actorUserId: outsider })).toHaveLength(0);
    expect(await getDocumentBytes(db, { workspaceId: otherWs, actorUserId: outsider, id: docOnOwnerRecord })).toBeNull();
    expect(
      (await updateDocumentMeta(db, { workspaceId: otherWs, actorUserId: outsider, id: docOnOwnerRecord, title: "x" })).ok,
    ).toBe(false);
    expect((await softDeleteDocument(db, { workspaceId: otherWs, actorUserId: outsider, id: docOnOwnerRecord })).ok).toBe(false);
  });

  it("a document cannot be attached to a record in another workspace", async () => {
    const res = await createDocument(db, {
      workspaceId: otherWs, actorUserId: outsider, filename: "x.pdf", mime: "application/pdf", bytes: pdf, recordId: recOwner,
    });
    expect(res.ok).toBe(false);
  });
});
