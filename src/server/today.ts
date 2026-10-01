import { and, eq, inArray } from "drizzle-orm";
import { objectDefs, obligations, records } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
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
  recordId: string;
  recordLabel: string;
  objectApiName: string;
  band: UrgencyBand;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOpen(tx: any, workspaceId: string): Promise<ObligationView[]> {
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
    .where(and(eq(obligations.workspaceId, workspaceId), inArray(obligations.status, ["open", "in_progress"])));
  return rows as unknown as (ObligationView & { reminderDates: string[]; status: string })[] as ObligationView[];
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
    const rows = await loadOpen(tx, cmd.workspaceId);
    const views = rows.map((r) => ({ ...r, band: urgencyBand(asEngineOb(r as any), cmd.today) }));
    views.sort((a, b) => sortForToday(asEngineOb(a as any), asEngineOb(b as any), cmd.today));
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
    const rows = (await loadOpen(tx, cmd.workspaceId)).filter((r) => r.dueDate);
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
