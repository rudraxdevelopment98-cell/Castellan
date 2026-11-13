import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord } from "@/server/records";
import { createDocument, softDeleteDocument } from "@/server/documents";
import { buildTodayPlan, buildWeekPlan } from "@/server/today";

/**
 * Document key dates appear on Today and This week alongside rule-generated
 * tasks, follow the document's reminder ladder, and respect record scope.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let ws: string;
let owner: string;
let member: string; // scope 'assigned'
let recOwner: string;
let recMember: string;
let otherWs: string;
let outsider: string;

const pdf = Buffer.from("%PDF-1.4 doc");

async function user(email: string) {
  const u = await createUser({ email, password: "a-strong-password", name: email }, { emailVerified: true });
  if (!u.ok) throw new Error("setup");
  return u.user.id;
}

async function doc(actor: string, title: string, keyDate: string, recordId?: string, reminderDays = [30, 7, 1], workspaceId = ws) {
  const r = await createDocument(db, {
    workspaceId, actorUserId: actor, filename: `${title}.pdf`, mime: "application/pdf", bytes: pdf, title, keyDate, recordId, reminderDays,
  });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

const today = (actorUserId: string, day: string, workspaceId = ws) => buildTodayPlan(db, { workspaceId, actorUserId, today: day });
const titles = (items: { title: string }[]) => items.map((i) => i.title).sort();

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
  owner = await user("owner@today-docs.test");
  member = await user("member@today-docs.test");
  outsider = await user("outsider@today-docs.test");
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Docs", slug: "today-docs" })).workspaceId;
  otherWs = (await createWorkspaceWithOwner(db, { ownerUserId: outsider, name: "Other", slug: "other-today" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "personal-home", withSamples: false });
  const objectId = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "item" }))!.id;
  await asService(db, (tx) => tx.insert(memberships).values({ workspaceId: ws, userId: member, role: "member", scopeType: "assigned" }));
  const mk = async (ownerId: string, name: string) => {
    const r = await createRecord(db, { workspaceId: ws, actorUserId: owner, objectId, input: { name }, ownerId });
    if (!r.ok) throw new Error("record");
    return r.recordId;
  };
  recOwner = await mk(owner, "Family car");
  recMember = await mk(member, "Member's flat");

  await doc(owner, "Car insurance", "2027-03-01", recOwner);
  await doc(member, "Flat insurance", "2027-03-01", recMember);
  await doc(owner, "Passport", "2027-03-01"); // not attached to anything
  await doc(outsider, "Outsider policy", "2027-03-01", undefined, [30, 7, 1], otherWs);
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("document key dates on Today", () => {
  it("are overdue after the date, due on the date, and 'good to start' on a reminder day", async () => {
    expect(titles((await today(owner, "2027-03-02")).overdue)).toEqual(["Car insurance renewal", "Flat insurance renewal", "Passport renewal"]);
    expect(titles((await today(owner, "2027-03-01")).dueToday)).toHaveLength(3);
    expect((await today(owner, "2027-01-30")).startSoon.length).toBe(3); // 30 days before
    const quiet = await today(owner, "2027-02-10");
    expect(quiet.counts.total).toBe(0); // not a reminder day
  });

  it("carry where they came from and link to their record when attached", async () => {
    const [car] = (await today(owner, "2027-03-01")).dueToday.filter((i) => i.title.startsWith("Car"));
    expect(car).toMatchObject({ source: "document", recordLabel: "Family car", recordId: recOwner, objectApiName: "item" });
    const [passport] = (await today(owner, "2027-03-01")).dueToday.filter((i) => i.title.startsWith("Passport"));
    expect(passport).toMatchObject({ recordId: "", recordLabel: "Not attached to anything" });
  });

  it("respect record scope: a restricted member sees only their own", async () => {
    expect(titles((await today(member, "2027-03-02")).overdue)).toEqual(["Flat insurance renewal"]);
  });

  it("never cross workspaces", async () => {
    expect(titles((await today(outsider, "2027-03-02", otherWs)).overdue)).toEqual(["Outsider policy renewal"]);
    expect(titles((await today(owner, "2027-03-02")).overdue)).not.toContain("Outsider policy renewal");
  });

  it("disappear when the document is removed", async () => {
    const id = await doc(owner, "Temporary", "2027-03-01");
    expect(titles((await today(owner, "2027-03-02")).overdue)).toContain("Temporary renewal");
    await softDeleteDocument(db, { workspaceId: ws, actorUserId: owner, id });
    expect(titles((await today(owner, "2027-03-02")).overdue)).not.toContain("Temporary renewal");
  });
});

describe("document key dates on This week", () => {
  it("appear on their day", async () => {
    const cols = await buildWeekPlan(db, { workspaceId: ws, actorUserId: owner, today: "2027-02-27" });
    const onFirst = cols.find((c) => c.date === "2027-03-01")!;
    expect(titles(onFirst.items)).toEqual(["Car insurance renewal", "Flat insurance renewal", "Passport renewal"]);
  });
});
