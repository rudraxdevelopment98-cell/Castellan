import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { memberships, workspaces } from "@/server/db/schema";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord } from "@/server/records";
import { createDocument } from "@/server/documents";
import { devOutbox } from "@/server/email/transport";
import { sendDailyBriefs, setBriefEmail } from "@/server/brief";
import { GET as cronRoute } from "@/app/api/cron/brief/route";

/**
 * AUDIT H9: the morning brief reaches each member once per local day, with
 * only what they may see, and never to those who switched it off, unverified
 * addresses, or suspended workspaces.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
let ws: string;
let owner: string;
let member: string; // scope 'assigned'
let quiet: string; // turned the email off
let unverified: string;

// 2027-03-02 07:00 London: the day after everything below fell due.
const RUN_AT = new Date("2027-03-02T07:00:00Z");
const pdf = Buffer.from("%PDF-1.4");
const briefsTo = (email: string) => devOutbox.filter((m) => m.kind === "daily_brief" && m.to === email);

async function user(email: string, verified = true) {
  const u = await createUser({ email, password: "a-strong-password", name: email }, { emailVerified: verified });
  if (!u.ok) throw new Error("setup");
  return u.user.id;
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
  owner = await user("owner@brief.test");
  member = await user("member@brief.test");
  quiet = await user("quiet@brief.test");
  unverified = await user("unverified@brief.test", false);
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Brief WS", slug: "brief" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "personal-home", withSamples: false });
  const objectId = (await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "item" }))!.id;
  for (const [u, scope] of [[member, "assigned"], [quiet, "all"], [unverified, "all"]] as const) {
    await asService(db, (tx) => tx.insert(memberships).values({ workspaceId: ws, userId: u, role: "member", scopeType: scope }));
  }
  await setBriefEmail({ workspaceId: ws, userId: quiet, on: false });

  const rec = async (ownerId: string, name: string) => {
    const r = await createRecord(db, { workspaceId: ws, actorUserId: owner, objectId, input: { name }, ownerId });
    if (!r.ok) throw new Error("record");
    return r.recordId;
  };
  const car = await rec(owner, "Family car");
  const flat = await rec(member, "Member's flat");
  for (const [title, recordId] of [["Car insurance", car], ["Flat insurance", flat]] as const) {
    const d = await createDocument(db, { workspaceId: ws, actorUserId: owner, filename: `${title}.pdf`, mime: "application/pdf", bytes: pdf, title, keyDate: "2027-03-01", recordId });
    if (!d.ok) throw new Error(d.error);
  }
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

beforeEach(() => {
  devOutbox.length = 0;
});

describe("daily brief (AUDIT H9)", () => {
  it("emails each member what is due, scoped to what they may see", async () => {
    const res = await sendDailyBriefs({ now: RUN_AT });
    expect(res.sent).toBe(2);

    const [ownerMail] = briefsTo("owner@brief.test");
    expect(ownerMail?.subject).toMatch(/2 overdue/);
    expect(ownerMail?.text).toContain("Car insurance renewal");
    expect(ownerMail?.text).toContain("Flat insurance renewal");

    const [memberMail] = briefsTo("member@brief.test");
    expect(memberMail?.text).toContain("Flat insurance renewal");
    expect(memberMail?.text).not.toContain("Car insurance");
  });

  it("does not email members who turned it off, or unverified addresses", async () => {
    await sendDailyBriefs({ now: RUN_AT });
    expect(briefsTo("quiet@brief.test")).toHaveLength(0);
    expect(briefsTo("unverified@brief.test")).toHaveLength(0);
  });

  it("sends at most once per local day, however often it runs", async () => {
    const again = await sendDailyBriefs({ now: new Date(RUN_AT.getTime() + 3600_000) });
    expect(again.sent).toBe(0);
    expect(devOutbox.filter((m) => m.kind === "daily_brief")).toHaveLength(0);
  });

  it("sends nothing on a day with nothing due", async () => {
    const res = await sendDailyBriefs({ now: new Date("2027-02-10T07:00:00Z") }); // not a reminder day, a Wednesday
    expect(res.sent).toBe(0);
    expect(res.skippedEmpty).toBeGreaterThan(0);
  });

  it("sends nothing for a suspended workspace", async () => {
    await asService(db, (tx) => tx.update(workspaces).set({ status: "suspended" }).where(eq(workspaces.id, ws)));
    const res = await sendDailyBriefs({ now: new Date("2027-03-03T07:00:00Z") });
    expect(res.sent).toBe(0);
    await asService(db, (tx) => tx.update(workspaces).set({ status: "trial" }).where(eq(workspaces.id, ws)));
  });
});

describe("cron route", () => {
  it("does not exist without CRON_SECRET, and rejects a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronRoute(new Request("http://x/api/cron/brief"))).status).toBe(404);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const bad = await cronRoute(new Request("http://x/api/cron/brief", { headers: { authorization: "Bearer nope" } }));
    expect(bad.status).toBe(401);
    const good = await cronRoute(new Request("http://x/api/cron/brief", { headers: { authorization: "Bearer s3cret-value" } }));
    expect(good.status).toBe(200);
    vi.unstubAllEnvs();
  });
});
