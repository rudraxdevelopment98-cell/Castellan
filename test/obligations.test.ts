import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, type AnyPgDb } from "@/server/db/client";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord } from "@/server/records";
import { regenerateObligations } from "@/server/obligations_gen";
import { buildTodayPlan, buildWeekPlan } from "@/server/today";

/**
 * Phase 4 exit criterion: the landlord template reproduces v1 obligation
 * behaviour on real engine data — rules over records generate dated obligations,
 * and Today bands them correctly.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let owner: string;
let ws: string;
let objectId: string;

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
  const u = await createUser({ email: "ob@example.com", password: "obliga pass here ok", name: "Ob" });
  if (!u.ok) throw new Error("setup");
  owner = u.user.id;
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Ob WS", slug: "ob" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "uk-landlord", withSamples: false });
  objectId = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" }))!.id;
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("obligation generation", () => {
  it("a gas check dated 10 Oct 2026 yields a due date of 10 Oct 2027", async () => {
    await createRecord(db, {
      workspaceId: ws, actorUserId: owner, objectId,
      input: { name: "22 Cable Street", has_gas: true, gas_last_check: "2026-10-10" },
    });
    await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
    // On "today" after the due date it is overdue; just before, it's due today.
    const overdue = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-11" });
    const gas = overdue.overdue.find((o) => o.title.includes("Gas") && o.recordLabel === "22 Cable Street");
    expect(gas?.dueDate).toBe("2027-10-10");

    const dueDay = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-10" });
    expect(dueDay.dueToday.some((o) => o.recordLabel === "22 Cable Street" && o.title.includes("Gas"))).toBe(true);
  });

  it("a property without gas gets no gas obligation (applies_when)", async () => {
    await createRecord(db, {
      workspaceId: ws, actorUserId: owner, objectId,
      input: { name: "No Gas House", has_gas: false, gas_last_check: "2026-01-01", insurance_end: "2030-01-01" },
    });
    await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
    const plan = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-10" });
    const gasForNoGas = [...plan.overdue, ...plan.dueToday, ...plan.startSoon].find(
      (o) => o.recordLabel === "No Gas House" && o.title.includes("Gas"),
    );
    expect(gasForNoGas).toBeUndefined();
  });

  it("insurance renewal (offset 0) is due on its end date", async () => {
    await createRecord(db, {
      workspaceId: ws, actorUserId: owner, objectId,
      input: { name: "Insured Flat", has_gas: false, insurance_end: "2026-11-01" },
    });
    await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
    const plan = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2026-11-01" });
    expect(plan.dueToday.some((o) => o.recordLabel === "Insured Flat" && o.category === "Insurance")).toBe(true);
  });

  it("regeneration is idempotent (no duplicate obligations)", async () => {
    await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
    const a = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-11" });
    await regenerateObligations(db, { workspaceId: ws, actorUserId: owner });
    const b = await buildTodayPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-11" });
    expect(b.counts.total).toBe(a.counts.total);
  });

  it("this-week plan has seven day columns", async () => {
    const week = await buildWeekPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-10-10" });
    expect(week).toHaveLength(7);
  });
});
