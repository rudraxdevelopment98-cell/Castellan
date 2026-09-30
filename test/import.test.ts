import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "./harness";
import { _setDbForTests, type AnyPgDb } from "@/server/db/client";
import { createUser } from "@/server/users";
import { createWorkspaceWithOwner } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { getObjectByApiName } from "@/server/metadata";
import { queryRecords } from "@/server/records_query";
import { analyzeImport, commitImport, undoImport } from "@/server/import";
import { parseCsv, toCsv } from "@/server/csv";
import { exportCsv } from "@/server/export";

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
  const u = await createUser({ email: "imp@example.com", password: "import pass here ok", name: "Imp" });
  if (!u.ok) throw new Error("setup");
  owner = u.user.id;
  ws = (await createWorkspaceWithOwner(db, { ownerUserId: owner, name: "Imp WS", slug: "imp" })).workspaceId;
  await applyTemplateToWorkspace(db, { workspaceId: ws, actorUserId: owner, templateId: "uk-landlord", withSamples: true });
  const obj = await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" });
  objectId = obj!.id;
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

describe("template materialisation", () => {
  it("creates the property object with fields and sample records", async () => {
    const obj = await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" });
    expect(obj).not.toBeNull();
    expect(obj!.fields.length).toBeGreaterThan(5);
    const page = await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId });
    expect(page.total).toBe(25);
    expect(page.rows[0]!.isSample).toBe(true);
  });
});

describe("csv parsing", () => {
  it("parses quoted fields, commas and embedded newlines", () => {
    const rows = parseCsv('name,note\n"22 Cable St","big, roomy\nflat"\n"1 Well Rd",ok');
    expect(rows).toEqual([
      ["name", "note"],
      ["22 Cable St", "big, roomy\nflat"],
      ["1 Well Rd", "ok"],
    ]);
  });
  it("neutralises formula injection on export", () => {
    const csv = toCsv(["a"], [["=SUM(A1)"]]);
    expect(csv).toContain("'=SUM(A1)");
  });
});

describe("import wizard: analyse, commit, undo", () => {
  const csv = [
    "Name,Postcode,Bedrooms,Rent",
    "9 Import Road,E1 1AA,2,1200",
    "10 Import Road,E1 1AB,notanumber,1300", // bedrooms invalid
    "11 Import Road,E1 1AC,4,1500",
  ].join("\n");
  const mapping = { name: 0, postcode: 1, bedrooms: 2, rent_pcm: 3 };

  it("dry-run reports ready and error rows without writing", async () => {
    const parsed = parseCsv(csv);
    const rows = parsed.slice(1);
    const before = (await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId })).total;
    const analysis = await analyzeImport(db, { workspaceId: ws, actorUserId: owner, objectId, mapping, rows });
    expect(analysis.total).toBe(3);
    expect(analysis.ready).toBe(2);
    expect(analysis.errorRows[0]?.errors[0]?.field).toBe("bedrooms");
    const after = (await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId })).total;
    expect(after).toBe(before); // nothing written during analyse
  });

  it("commits valid rows and undo removes exactly them", async () => {
    const rows = parseCsv(csv).slice(1);
    const before = (await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId })).total;
    const res = await commitImport(db, { workspaceId: ws, actorUserId: owner, objectId, mapping, rows });
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(1);
    const mid = (await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId })).total;
    expect(mid).toBe(before + 2);
    const undo = await undoImport(db, { workspaceId: ws, actorUserId: owner, importId: res.importId });
    expect(undo.removed).toBe(2);
    const after = (await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId })).total;
    expect(after).toBe(before);
  });
});

describe("keyset pagination + export", () => {
  it("pages through all records without overlap", async () => {
    const seen = new Set<string>();
    let cursor: { updatedAt: string; id: string } | null = null;
    let pages = 0;
    for (;;) {
      const page = await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId, limit: 10, cursor });
      for (const r of page.rows) seen.add(r.id);
      pages++;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (pages > 20) throw new Error("pagination did not terminate");
    }
    expect(seen.size).toBe(25);
    expect(pages).toBe(3); // 10 + 10 + 5
  });

  it("search narrows results", async () => {
    const all = await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId, limit: 250 });
    const first = all.rows[0]!;
    const term = String(first.title).split(" ")[0]!;
    const res = await queryRecords(db, { workspaceId: ws, actorUserId: owner, objectId, search: term, limit: 250 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.rows.every((r) => JSON.stringify(r).toLowerCase().includes(term.toLowerCase()))).toBe(true);
  });

  it("exports the view to CSV with a header row", async () => {
    const obj = await getObjectByApiName(db, { workspaceId: ws, actorUserId: owner, apiName: "property" });
    const csv = await exportCsv(db, { workspaceId: ws, actorUserId: owner, objectId, fields: obj!.fields });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Title");
    expect(lines.length).toBe(1 + 25);
  });
});
