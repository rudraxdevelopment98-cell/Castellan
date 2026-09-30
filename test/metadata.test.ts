import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, type AnyPgDb } from "@/server/db/client";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { addField, createObject, getObjectByApiName } from "@/server/metadata";
import {
  createRecord,
  getRecordHistory,
  listRecords,
  softDeleteRecord,
  restoreRecord,
  updateRecord,
} from "@/server/records";

/**
 * Phase 2 exit criterion: an admin creates an object with 10 fields and a
 * relation; records validate and history shows diffs. Plus soft delete, unique,
 * relation existence and cross-tenant isolation of records.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let owner: string;
let wsA: string;
let wsB: string;
let propertyObjId: string;
let tenancyObjId: string;

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);

  const u = await createUser({ email: "admin@example.com", password: "admin pass here ok", name: "Admin" });
  if (!u.ok) throw new Error("setup");
  owner = u.user.id;
  wsA = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Alpha", slug: "alpha" })).workspaceId;
  wsB = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Beta", slug: "beta" })).workspaceId;

  // A "Property" object with a title field.
  propertyObjId = (await createObject(db, {
    workspaceId: wsA, actorUserId: owner, apiName: "property",
    singularLabel: "Property", pluralLabel: "Properties", titleFieldApiName: "address",
  })).objectId;

  // A "Tenancy" object to relate to.
  tenancyObjId = (await createObject(db, {
    workspaceId: wsA, actorUserId: owner, apiName: "tenancy",
    singularLabel: "Tenancy", pluralLabel: "Tenancies", titleFieldApiName: "reference",
  })).objectId;

  await addField(db, { workspaceId: wsA, actorUserId: owner, objectId: tenancyObjId, apiName: "reference", label: "Reference", type: "text", required: true, unique: true });

  // Ten fields on Property (incl. one relation to Tenancy).
  const fields: Parameters<typeof addField>[1][] = [
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "address", label: "Address", type: "text", required: true, position: 1 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "postcode", label: "Postcode", type: "address", position: 2 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "rent_pcm", label: "Rent (pcm)", type: "currency", position: 3 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "bedrooms", label: "Bedrooms", type: "number", config: { min: 0, max: 20 }, position: 4 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "has_gas", label: "Has gas", type: "boolean", position: 5 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "type", label: "Type", type: "single_select", config: { options: [{ id: "flat", label: "Flat" }, { id: "house", label: "House" }] }, position: 6 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "epc_expiry", label: "EPC expiry", type: "date", position: 7 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "manager_email", label: "Manager email", type: "email", unique: true, position: 8 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "current_tenancy", label: "Current tenancy", type: "relation", config: { targetObject: tenancyObjId }, position: 9 },
    { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, apiName: "key_safe", label: "Key safe code", type: "sensitive_text", position: 10 },
  ];
  for (const fld of fields) await addField(db, fld);
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("metadata engine", () => {
  it("an object exposes its 10 fields incl. a relation", async () => {
    const obj = await getObjectByApiName(db, { workspaceId: wsA, actorUserId: owner, apiName: "property" });
    expect(obj).not.toBeNull();
    expect(obj!.fields).toHaveLength(10);
    expect(obj!.fields.find((f) => f.type === "relation")?.apiName).toBe("current_tenancy");
  });
});

describe("records: validate, normalise, relate", () => {
  let tenancyId: string;

  it("creates a related tenancy record", async () => {
    const res = await createRecord(db, {
      workspaceId: wsA, actorUserId: owner, objectId: tenancyObjId, input: { reference: "TEN-001" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) tenancyId = res.recordId;
  });

  it("normalises values and links the relation", async () => {
    const res = await createRecord(db, {
      workspaceId: wsA, actorUserId: owner, objectId: propertyObjId,
      input: {
        address: "22 Cable Street",
        postcode: { line1: "22 Cable Street", postcode: "e1 8ab" },
        rent_pcm: "£1,500",
        bedrooms: "2",
        has_gas: "yes",
        type: "Flat",
        epc_expiry: "03/04/2030",
        manager_email: "MGR@Example.com",
        current_tenancy: tenancyId,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rec = await import("@/server/records").then((m) => m.getRecord(db, { workspaceId: wsA, actorUserId: owner, recordId: res.recordId }));
    const data = rec!.data as Record<string, unknown>;
    expect(data.rent_pcm).toBe(150000); // minor units
    expect(data.has_gas).toBe(true);
    expect(data.type).toBe("flat");
    expect(data.epc_expiry).toBe("2030-04-03");
    expect(data.manager_email).toBe("mgr@example.com");
    expect((data.postcode as { postcode: string }).postcode).toBe("E1 8AB");
    expect(rec!.title).toBe("22 Cable Street");
  });

  it("rejects a record missing a required field, with a field error", async () => {
    const res = await createRecord(db, { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, input: { rent_pcm: "£900" } });
    expect(res.ok).toBe(false);
    if (!res.ok && "errors" in res) expect(res.errors.some((e) => e.field === "address" && e.code === "required")).toBe(true);
  });

  it("enforces unique fields", async () => {
    await createRecord(db, { workspaceId: wsA, actorUserId: owner, objectId: tenancyObjId, input: { reference: "TEN-DUP" } });
    const dup = await createRecord(db, { workspaceId: wsA, actorUserId: owner, objectId: tenancyObjId, input: { reference: "TEN-DUP" } });
    expect(dup.ok).toBe(false);
    if (!dup.ok && "errors" in dup) expect(dup.errors[0]?.code).toBe("duplicate");
  });

  it("rejects a relation to a non-existent record", async () => {
    const res = await createRecord(db, {
      workspaceId: wsA, actorUserId: owner, objectId: propertyObjId,
      input: { address: "X", current_tenancy: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok && "errors" in res) expect(res.errors[0]?.code).toBe("missing_relation");
  });
});

describe("records: history diffs, optimistic lock, soft delete", () => {
  let recId: string;
  let version: number;

  it("update records field-level diffs", async () => {
    const created = await createRecord(db, { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId, input: { address: "1 First Road", bedrooms: "1" } });
    if (!created.ok) throw new Error("setup");
    recId = created.recordId; version = created.version;

    const upd = await updateRecord(db, { workspaceId: wsA, actorUserId: owner, recordId: recId, input: { bedrooms: "3", address: "1 First Road" }, expectedVersion: version });
    expect(upd.ok).toBe(true);

    const history = await getRecordHistory(db, { workspaceId: wsA, actorUserId: owner, recordId: recId });
    const bedroomsDiff = history.find((h: { field: string }) => h.field === "bedrooms");
    expect(bedroomsDiff).toBeTruthy();
    expect(bedroomsDiff.before).toBe(1);
    expect(bedroomsDiff.after).toBe(3);
    // address unchanged -> no diff row for it in this update
    const addressDiffs = history.filter((h: { field: string }) => h.field === "address");
    expect(addressDiffs.length).toBe(0);
  });

  it("blocks a stale update (optimistic lock)", async () => {
    const stale = await updateRecord(db, { workspaceId: wsA, actorUserId: owner, recordId: recId, input: { bedrooms: "9" }, expectedVersion: version });
    expect(stale.ok).toBe(false);
    if (!stale.ok && "conflict" in stale) expect(stale.conflict).toBe(true);
  });

  it("soft deletes and restores", async () => {
    await softDeleteRecord(db, { workspaceId: wsA, actorUserId: owner, recordId: recId });
    let live = await listRecords(db, { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId });
    expect(live.find((r: { id: string }) => r.id === recId)).toBeUndefined();
    await restoreRecord(db, { workspaceId: wsA, actorUserId: owner, recordId: recId });
    live = await listRecords(db, { workspaceId: wsA, actorUserId: owner, objectId: propertyObjId });
    expect(live.find((r: { id: string }) => r.id === recId)).toBeTruthy();
  });
});

describe("records isolation", () => {
  it("records and objects do not leak across workspaces", async () => {
    // wsB has no objects; listing wsA's object id while scoped to B returns nothing.
    const leaked = await listRecords(db, { workspaceId: wsB, actorUserId: owner, objectId: propertyObjId });
    expect(leaked).toHaveLength(0);
    const objB = await getObjectByApiName(db, { workspaceId: wsB, actorUserId: owner, apiName: "property" });
    expect(objB).toBeNull();
  });
});
