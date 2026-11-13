import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { documents, objectDefs, obligations, records } from "./db/schema";
import { documentScopeCondition } from "./documents";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { actorContextInTx, recordScopeCondition } from "./membership";
import { addDays, diffDays, type IsoDate } from "@/lib/rules/dates";
import { sortForToday, urgencyBand, type UrgencyBand } from "@/lib/rules/engine";
import type { Obligation } from "@/lib/rules/types";

/**
 * Today / This-week, regenerated from the engine's obligations (spec Phase 4:
 * the v1 screens, now generic). Banding and ordering reuse the tested Phase-1
 * engine; only the data source changed (DB obligations instead of in-memory).
 */

export interface ObligationView {
  id: string;
  title: string;
  why: string | null;
  category: string;
  dueDate: IsoDate | null;
  /** Empty for a document not attached to any record. */
  recordId: string;
  recordLabel: string;
  objectApiName: string;
  band: UrgencyBand;
  /** Where the item came from: a rule over a record, or a document's key date. */
  source: "rule" | "document";
  documentId?: string;
}

/** An open obligation as loaded, before it is banded for a given day. */
type OpenRow = Omit<ObligationView, "band"> & { reminderDates: string[]; status: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOpen(tx: any, workspaceId: string, actorUserId: string): Promise<OpenRow[]> {
  // Obligations name the record they belong to, so they follow record scope:
  // a member only sees obligations for records they are allowed to see.
  const me = await actorContextInTx(tx, workspaceId, actorUserId);
  const scope = recordScopeCondition(me.scopeType, actorUserId);
  const base = and(eq(obligations.workspaceId, workspaceId), inArray(obligations.status, ["open", "in_progress"]));
  const rows = await tx
    .select({
      id: obligations.id,
      title: obligations.title,
      why: obligations.why,
      category: obligations.category,
      dueDate: obligations.dueDate,
      reminderDates: obligations.reminderDates,
      status: obligations.status,
      recordId: obligations.recordId,
      recordLabel: records.title,
      objectApiName: objectDefs.apiName,
    })
    .from(obligations)
    .innerJoin(records, eq(records.id, obligations.recordId))
    .innerJoin(objectDefs, eq(objectDefs.id, records.objectId))
    .where(scope ? and(base, scope) : base);
  const fromRules = (rows as Omit<OpenRow, "source">[]).map((r) => ({ ...r, source: "rule" as const }));
  return [...fromRules, ...(await loadDocumentDates(tx, workspaceId, actorUserId, me.scopeType))];
}

/**
 * Documents with a key date are due items too (one place for everything that
 * can lapse). The date was typed by a person when uploading, so it is a
 * confirmed date; reminders follow the document's own ladder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDocumentDates(tx: any, workspaceId: string, actorUserId: string, scopeType: string): Promise<OpenRow[]> {
  const scope = documentScopeCondition(scopeType, actorUserId);
  const base = and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt), isNotNull(documents.keyDate));
  const rows = await tx
    .select({
      id: documents.id,
      title: documents.title,
      filename: documents.filename,
      docType: documents.docType,
      note: documents.note,
      keyDate: documents.keyDate,
      reminderDays: documents.reminderDays,
      recordId: documents.recordId,
      recordLabel: records.title,
      objectApiName: objectDefs.apiName,
    })
    .from(documents)
    .leftJoin(records, eq(records.id, documents.recordId))
    .leftJoin(objectDefs, eq(objectDefs.id, records.objectId))
    .where(scope ? and(base, scope) : base);
  return rows.map(
    (d: {
      id: string; title: string | null; filename: string; docType: string | null; note: string | null;
      keyDate: string; reminderDays: number[] | null; recordId: string | null; recordLabel: string | null; objectApiName: string | null;
    }) => ({
      id: `doc:${d.id}`,
      documentId: d.id,
      source: "document" as const,
      title: `${d.title || d.filename} renewal`,
      why: d.note || "Key date on an uploaded document.",
      category: d.docType || "Document",
      dueDate: d.keyDate,
      reminderDates: (d.reminderDays ?? []).map((n) => addDays(d.keyDate, -n)),
      status: "open",
      recordId: d.recordId ?? "",
      recordLabel: d.recordLabel ?? "Not attached to anything",
      objectApiName: d.objectApiName ?? "",
    }),
  );
}

function asEngineOb(v: { dueDate: string | null; reminderDates?: string[]; status?: string }): Obligation {
  return {
    id: "", ruleCode: "", recordId: "", title: "", why: "", category: "",
    dueDate: v.dueDate, reminderDates: v.reminderDates ?? [], status: (v.status as Obligation["status"]) ?? "open",
    evidenceRequired: false, provisional: false,
  };
}

export interface TodayPlan {
  today: IsoDate;
  overdue: ObligationView[];
  dueToday: ObligationView[];
  startSoon: ObligationView[];
  counts: { total: number; overdue: number; urgent: number };
}

export async function buildTodayPlan(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; today: IsoDate },
): Promise<TodayPlan> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const rows = await loadOpen(tx, cmd.workspaceId, cmd.actorUserId);
    const views = rows.map((r) => ({ ...r, band: urgencyBand(asEngineOb(r), cmd.today) }));
    views.sort((a, b) => sortForToday(asEngineOb(a), asEngineOb(b), cmd.today));
    const overdue = views.filter((v) => v.band === "overdue");
    const dueToday = views.filter((v) => v.band === "due_today");
    const startSoon = views.filter((v) => v.band === "start_soon");
    return {
      today: cmd.today,
      overdue, dueToday, startSoon,
      counts: { total: overdue.length + dueToday.length + startSoon.length, overdue: overdue.length, urgent: overdue.length + dueToday.length },
    };
  });
}

export interface DayColumn { date: IsoDate; label: string; items: ObligationView[] }

export async function buildWeekPlan(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; today: IsoDate },
): Promise<DayColumn[]> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const rows: ObligationView[] = (await loadOpen(tx, cmd.workspaceId, cmd.actorUserId))
      .filter((r) => r.dueDate)
      .map((r) => ({ ...r, band: urgencyBand(asEngineOb(r), cmd.today) }));
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const cols: DayColumn[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cmd.today, i);
      const [y, m, d] = date.split("-").map(Number);
      const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
      const items = rows.filter((r) => (i === 0 ? diffDays(r.dueDate!, date) <= 0 : r.dueDate === date));
      cols.push({ date, label: `${weekdays[dow]} ${Number(d)}`, items });
    }
    return cols;
  });
}
