import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import {
  createRecord,
  getRecord,
  getRecordHistory,
  listRecords,
  updateRecord,
  softDeleteRecord,
} from "@/server/records";
import { queryRecords } from "@/server/records_query";
import { regenerateObligations } from "@/server/obligations_gen";
import { buildTodayPlan, buildWeekPlan } from "@/server/today";

/**
 * AUDIT C1/C2: record scope must be enforced on every read and mutate path.
 * A member scoped to their own records (scope 'assigned'), or to a team/filter
 * (which fail closed), must never reach another member's records — by list,
 * query, direct id, history, edit or delete. Only 'all' sees the whole workspace.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let owner: string; // scope 'all'
let bob: string; // scope 'assigned'
let cara: string; // scope 'team' (fails closed to own)
let dan: string; // admin (can delete) but scope 'assigned'
let ws: string;
let objectId: string;
let recOwner: string; // owned by owner
let recBob: string; // owned by bob
let recCara: string; // owned by cara

async function addMember(
  userId: string,
  scopeType: "all" | "assigned" | "team" | "filter",
  role: "member" | "admin" = "member",
) {
  await asService(db, (tx) =>
    tx.insert(memberships).values({ workspaceId: ws, userId, role, scopeType }),
  );
}

async function makeRecord(ownerId: string, name: string): Promise<string> {
  const res = await createRecord(db, { workspaceId: ws, actorUserId: owner, objectId, input: { name, insurance_end: "2027-06-01" }, ownerId });
  if (!res.ok) throw new Error("record create failed");
  return res.recordId;
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);

  owner = (await createUser({ email: "owner@scope.test", password: "a-strong-password", name: "Owner" }, { emailVerified: true }) as { user: { id: string } }).user.id;
  bob = (await createUser({ email: "bob@scope.test", password: "a-strong-password", name: "Bob" }, { emailVerified: true }) as { user: { id: string } }).user.id;
  cara = (await createUser({ email: "cara@scope.test", password: "a-strong-password", name: "Cara" }, { emailVerified: true }) as { user: { id: string } }).user.id;

  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Scope WS", slug: "scope" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "uk-landlord", withSamples: false });
  objectId = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" }))!.id;

  dan = (await createUser({ email: "dan@scope.test", password: "a-strong-password", name: "Dan" }, { emailVerified: true }) as { user: { id: string } }).user.id;

  await addMember(bob, "assigned");
  await addMember(cara, "team");
  await addMember(dan, "assigned", "admin");

  recOwner = await makeRecord(owner, "Owner House");
  recBob = await makeRecord(bob, "Bob House");
  recCara = await makeRecord(cara, "Cara House");
  // Every record now has an insurance renewal obligation due 2027-06-01.
  await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("record scope enforcement (AUDIT C1/C2)", () => {
  it("owner (scope 'all') sees every record", async () => {
    const rows = await listRecords(db, { workspaceId: ws, actorUserId: owner, objectId });
    expect(rows.length).toBe(3);
  });

  it("assigned-scope member only lists their own records", async () => {
    const rows = await listRecords(db, { workspaceId: ws, actorUserId: bob, objectId });
    expect(rows.map((r: { id: string }) => r.id)).toEqual([recBob]);
  });

  it("assigned-scope member cannot fetch another's record by id", async () => {
    expect(await getRecord(db, { workspaceId: ws, actorUserId: bob, recordId: recOwner })).toBeNull();
    expect(await getRecord(db, { workspaceId: ws, actorUserId: bob, recordId: recBob })).not.toBeNull();
  });

  it("assigned-scope member cannot read another's record history", async () => {
    const hist = await getRecordHistory(db, { workspaceId: ws, actorUserId: bob, recordId: recOwner });
    expect(hist).toHaveLength(0);
  });

  it("assigned-scope member cannot edit another's record", async () => {
    await expect(
      updateRecord(db, { workspaceId: ws, actorUserId: bob, recordId: recOwner, input: { name: "Hacked" } }),
    ).rejects.toThrow(/not found/i);
  });

  it("a scope-restricted role that CAN delete still cannot delete another's record", async () => {
    // dan is an admin (has records.delete) but scoped to his own records.
    await expect(
      softDeleteRecord(db, { workspaceId: ws, actorUserId: dan, recordId: recOwner }),
    ).rejects.toThrow(/not found/i);
    // and the record is untouched
    expect(await getRecord(db, { workspaceId: ws, actorUserId: owner, recordId: recOwner })).not.toBeNull();
  });

  it("assigned-scope member's grid query returns only their rows", async () => {
    const res = await queryRecords(db, { workspaceId: ws, actorUserId: bob, objectId });
    expect(res.total).toBe(1);
    expect(res.rows.map((r) => r.id)).toEqual([recBob]);
  });

  it("team-scope fails closed to own records (no workspace-wide leak)", async () => {
    const rows = await listRecords(db, { workspaceId: ws, actorUserId: cara, objectId });
    expect(rows.map((r: { id: string }) => r.id)).toEqual([recCara]);
    expect(await getRecord(db, { workspaceId: ws, actorUserId: cara, recordId: recOwner })).toBeNull();
  });

  it("Today only shows obligations for records in scope (AUDIT C3)", async () => {
    const all = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-06-02" });
    expect(new Set(all.overdue.map((o) => o.recordLabel))).toEqual(new Set(["Owner House", "Bob House", "Cara House"]));

    const mine = await buildTodayPlan(db, { workspaceId: ws, actorUserId: bob, today: "2027-06-02" });
    expect(mine.overdue.map((o) => o.recordLabel)).toEqual(["Bob House"]);
    expect(mine.counts.total).toBe(1);
  });

  it("This-week only shows obligations for records in scope (AUDIT C3)", async () => {
    const cols = await buildWeekPlan(db, { workspaceId: ws, actorUserId: cara, today: "2027-06-01" });
    const labels = cols.flatMap((c) => c.items.map((i) => i.recordLabel));
    expect(labels).toEqual(["Cara House"]);
  });
});
