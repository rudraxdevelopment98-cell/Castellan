import { addDays, diffDays, type IsoDate } from "../rules/dates";
import {
  cellStatus,
  generateAllObligations,
  ruleApplies,
  sortForToday,
  urgencyBand,
  type UrgencyBand,
} from "../rules/engine";
import type {
  CellStatus,
  Obligation,
  ObligationRule,
  TrackedRecord,
} from "../rules/types";
import type { WorkspaceData } from "../data/types";

/** An obligation joined to its record, for display. */
export interface ObligationView extends Obligation {
  recordLabel: string;
  recordSublabel?: string;
  band: UrgencyBand;
}

export function buildObligationViews(
  data: WorkspaceData,
  today: IsoDate,
): ObligationView[] {
  const byId = new Map(data.records.map((r) => [r.id, r]));
  const obligations = generateAllObligations(data.records, data.template.rules);
  return obligations.map((ob) => {
    const rec = byId.get(ob.recordId)!;
    return {
      ...ob,
      recordLabel: rec.label,
      recordSublabel: rec.sublabel,
      band: urgencyBand(ob, today),
    };
  });
}

export interface TodayPlan {
  today: IsoDate;
  overdue: ObligationView[];
  dueToday: ObligationView[];
  startSoon: ObligationView[];
  counts: { total: number; overdue: number; urgent: number };
}

/**
 * The Today screen: overdue first, then due today, then long-lead items whose
 * first reminder has fired ("good to start today"). Everything else is not
 * shown here (it lives in This week / the matrix).
 */
export function buildTodayPlan(data: WorkspaceData, today: IsoDate): TodayPlan {
  const views = buildObligationViews(data, today)
    .filter((v) => v.status === "open" || v.status === "in_progress")
    .sort((a, b) => sortForToday(a, b, today));

  const overdue = views.filter((v) => v.band === "overdue");
  const dueToday = views.filter((v) => v.band === "due_today");
  const startSoon = views.filter((v) => v.band === "start_soon");

  return {
    today,
    overdue,
    dueToday,
    startSoon,
    counts: {
      total: overdue.length + dueToday.length + startSoon.length,
      overdue: overdue.length,
      urgent: overdue.length + dueToday.length,
    },
  };
}

/** Uninsured records — anything the insurance rule applies to with no cover. */
export function findUninsured(data: WorkspaceData): TrackedRecord[] {
  const insuranceRule = data.template.rules.find(
    (r) => r.category === "Insurance" && r.enabled,
  );
  if (!insuranceRule) return [];
  return data.records.filter(
    (r) => ruleApplies(r, insuranceRule) && !r.triggers[insuranceRule.triggerField],
  );
}

export interface DayColumn {
  date: IsoDate;
  label: string;
  items: ObligationView[];
}

/** This week: seven day-columns from today, grouped by planned/due date. */
export function buildWeekPlan(data: WorkspaceData, today: IsoDate): DayColumn[] {
  const views = buildObligationViews(data, today).filter(
    (v) => (v.status === "open" || v.status === "in_progress") && v.dueDate,
  );
  const cols: DayColumn[] = [];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
    const dueThisDay = views.filter((v) => {
      const target = v.plannedDate ?? v.dueDate!;
      // Overdue items pile onto "today" (day 0) so nothing is lost.
      if (i === 0) return diffDays(target, date) <= 0;
      return target === date;
    });
    cols.push({
      date,
      label: `${weekdays[dow]} ${Number(d)}`,
      items: dueThisDay.sort((a, b) => sortForToday(a, b, today)),
    });
  }
  return cols;
}

/** Next-90-days clusters, e.g. "38 gas checks in November". */
export function buildLookahead(
  data: WorkspaceData,
  today: IsoDate,
): { month: string; category: string; count: number }[] {
  const horizon = addDays(today, 90);
  const views = buildObligationViews(data, today).filter(
    (v) => v.dueDate && v.dueDate >= today && v.dueDate <= horizon,
  );
  const byKey = new Map<string, number>();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const v of views) {
    const [y, m] = v.dueDate!.split("-").map(Number);
    const key = `${monthNames[m! - 1]} ${y}::${v.category}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  return [...byKey.entries()]
    .map(([key, count]) => {
      const [month, category] = key.split("::");
      return { month: month!, category: category!, count };
    })
    .sort((a, b) => b.count - a.count);
}

export interface MatrixCell {
  status: CellStatus;
  category: string;
}

export interface MatrixRow {
  record: TrackedRecord;
  cells: MatrixCell[];
}

export interface ComplianceMatrix {
  categories: string[];
  rows: MatrixRow[];
  totals: Record<CellStatus, number>;
}

/**
 * The compliance matrix — the product's signature screen. One row per record,
 * one column per rule category, each cell a status square.
 */
export function buildMatrix(
  data: WorkspaceData,
  today: IsoDate,
  limit?: number,
): ComplianceMatrix {
  // One column per distinct rule category, in template order.
  const seen = new Set<string>();
  const cols: { category: string; rule: ObligationRule }[] = [];
  for (const rule of data.template.rules) {
    if (!rule.enabled || rule.cadence.kind === "watch") continue;
    if (seen.has(rule.category)) continue;
    seen.add(rule.category);
    cols.push({ category: rule.category, rule });
  }

  const totals: Record<CellStatus, number> = {
    valid: 0,
    due_soon: 0,
    overdue: 0,
    missing: 0,
    not_applicable: 0,
  };

  const records = limit ? data.records.slice(0, limit) : data.records;
  const rows: MatrixRow[] = records.map((record) => {
    const cells = cols.map(({ category, rule }) => {
      const status = cellStatus(record, rule, today);
      totals[status] += 1;
      return { status, category };
    });
    return { record, cells };
  });

  return { categories: cols.map((c) => c.category), rows, totals };
}

/**
 * PRS-database registration readiness: a property is "ready" when it has the
 * evidence the register requires (gas where applicable, EICR, EPC, licence
 * where applicable) all currently valid.
 */
export function registrationReadiness(
  data: WorkspaceData,
  today: IsoDate,
): { ready: number; total: number } {
  const required = data.template.rules.filter((r) =>
    ["Gas", "Electric", "EPC", "Licence"].includes(r.category),
  );
  let ready = 0;
  for (const record of data.records) {
    const ok = required.every((rule) => {
      if (!ruleApplies(record, rule)) return true; // N/A counts as satisfied
      return cellStatus(record, rule, today) === "valid" ||
        cellStatus(record, rule, today) === "due_soon";
    });
    if (ok) ready += 1;
  }
  return { ready, total: data.records.length };
}
