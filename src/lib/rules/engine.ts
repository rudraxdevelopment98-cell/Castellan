import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  diffDays,
  type IsoDate,
} from "./dates";
import type {
  CellStatus,
  Cadence,
  Condition,
  Obligation,
  ObligationRule,
  ObligationStatus,
  TrackedRecord,
} from "./types";

/**
 * The rules engine. Pure functions, no I/O, no dates read from the clock
 * unless passed in. Everything here is unit-tested (engine.test.ts) with
 * fixed dates so leap years, month ends and BST can't regress silently.
 */

/** Read a field from a record, checking explicit fields then triggers. */
function readField(
  record: TrackedRecord,
  field: string,
): string | number | boolean | null | undefined {
  if (field in record.fields) return record.fields[field];
  if (field in record.triggers) return record.triggers[field];
  return undefined;
}

export function evaluateCondition(
  record: TrackedRecord,
  cond: Condition,
): boolean {
  if ("kind" in cond && cond.kind === "always") return true;
  if (!("field" in cond)) return false;

  const raw = readField(record, cond.field);

  switch (cond.op) {
    case "exists":
      return raw !== undefined && raw !== null && raw !== "";
    case "eq":
      return raw === cond.value;
    case "neq":
      return raw !== cond.value;
    case "in":
      return raw != null && cond.value.includes(raw as string | number);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof raw !== "number") return false;
      if (cond.op === "gt") return raw > cond.value;
      if (cond.op === "gte") return raw >= cond.value;
      if (cond.op === "lt") return raw < cond.value;
      return raw <= cond.value;
    }
    default:
      return false;
  }
}

/** A rule applies to a record when every condition holds (AND semantics). */
export function ruleApplies(record: TrackedRecord, rule: ObligationRule): boolean {
  if (!rule.enabled) return false;
  if (rule.appliesWhen.length === 0) return true;
  return rule.appliesWhen.every((c) => evaluateCondition(record, c));
}

/**
 * Compute the due date from a trigger date and a cadence.
 * Returns null for "watch" rules (no due date until confirmed).
 */
export function computeDueDate(
  cadence: Cadence,
  triggerDate: IsoDate | undefined,
): IsoDate | null {
  switch (cadence.kind) {
    case "recurring_months":
      return triggerDate ? addMonths(triggerDate, cadence.every) : null;
    case "recurring_years":
      return triggerDate ? addYears(triggerDate, cadence.every) : null;
    case "offset_days":
      return triggerDate ? addDays(triggerDate, cadence.days) : null;
    case "fixed_date":
      return cadence.date;
    case "watch":
      return null;
  }
}

/**
 * Reminder dates from the ladder, e.g. dueDate=2027-10-10 ladder=[60,30,14,7,1]
 * => the five dates counting back from the due date. Never past the due date.
 */
export function computeReminderDates(
  dueDate: IsoDate,
  ladderDays: number[],
): IsoDate[] {
  return ladderDays
    .filter((d) => d >= 0)
    .map((d) => addDays(dueDate, -d))
    .sort(compareDates);
}

export interface GenerateOptions {
  /** "today" for status derivation; defaults must be supplied by caller. */
  today: IsoDate;
}

/**
 * Generate one obligation for a (record, rule) pair, if the rule applies.
 * Returns null when the rule does not apply to the record.
 *
 * `provisional` marks obligations whose trigger came from an unconfirmed
 * document — the spec forbids creating a *legal* reminder from an unreviewed
 * date, so callers filter provisional items out of notifications.
 */
export function generateObligation(
  record: TrackedRecord,
  rule: ObligationRule,
  opts: { provisionalTrigger?: boolean } = {},
): Obligation | null {
  if (!ruleApplies(record, rule)) return null;

  const triggerDate = record.triggers[rule.triggerField];
  const dueDate = computeDueDate(rule.cadence, triggerDate);
  const reminderDates =
    dueDate && rule.cadence.kind !== "watch"
      ? computeReminderDates(dueDate, rule.reminderLadderDays)
      : [];

  return {
    id: `${record.id}::${rule.code}`,
    ruleCode: rule.code,
    recordId: record.id,
    title: rule.title,
    why: rule.why,
    category: rule.category,
    dueDate,
    reminderDates,
    status: "open",
    evidenceRequired: rule.evidenceRequired,
    oneOff: rule.oneOff,
    provisional: Boolean(opts.provisionalTrigger),
  };
}

/** Generate all obligations across every record x every enabled rule. */
export function generateAllObligations(
  records: TrackedRecord[],
  rules: ObligationRule[],
): Obligation[] {
  const out: Obligation[] = [];
  for (const record of records) {
    for (const rule of rules) {
      const ob = generateObligation(record, rule);
      if (ob) out.push(ob);
    }
  }
  return out;
}

/**
 * When a rule is completed with a new trigger date (e.g. a new gas certificate
 * dated 2027-10-10 is confirmed), produce the *next cycle's* obligation.
 * Completed history is never altered — this returns a fresh obligation.
 */
export function nextCycle(
  record: TrackedRecord,
  rule: ObligationRule,
  newTriggerDate: IsoDate,
): Obligation | null {
  const updated: TrackedRecord = {
    ...record,
    triggers: { ...record.triggers, [rule.triggerField]: newTriggerDate },
  };
  return generateObligation(updated, rule);
}

/** Days until due; negative when overdue. Null-safe for watch items. */
export function daysUntilDue(ob: Obligation, today: IsoDate): number | null {
  if (!ob.dueDate) return null;
  return diffDays(ob.dueDate, today);
}

export type UrgencyBand = "overdue" | "due_today" | "start_soon" | "later" | "watch";

/**
 * Bucket an obligation for the Today screen.
 *
 * The Today list is a *daily* plan, not a backlog: an item surfaces only when
 * it is overdue, due today, or one of its reminder rungs fires today. This is
 * why at 500 properties Today stays a handful of items each morning rather than
 * every obligation whose window happens to be open (spec notifications.principle).
 * "start_soon" = a reminder rung lands on today, so today is the day to act.
 */
export function urgencyBand(ob: Obligation, today: IsoDate): UrgencyBand {
  if (ob.status === "done" || ob.status === "not_applicable") return "later";
  if (!ob.dueDate) return "watch";
  const d = diffDays(ob.dueDate, today);
  // A one-off whose deadline has passed is treated as completed, not overdue.
  if (ob.oneOff && d < 0) return "later";
  if (d < 0) return "overdue";
  if (d === 0) return "due_today";
  if (ob.reminderDates.some((r) => diffDays(r, today) === 0)) return "start_soon";
  return "later";
}

/**
 * An overdue item can never simply vanish — it may only be snoozed with a
 * reason and a new date (acceptance rule for the Today screen). Snoozing is
 * still visible: the obligation returns to view once snoozedUntil passes.
 */
export function isSnoozeActive(ob: Obligation, today: IsoDate): boolean {
  if (ob.status !== "snoozed" || !ob.snoozedUntil) return false;
  return diffDays(ob.snoozedUntil, today) > 0;
}

/** Compliance-matrix cell status for one (record, rule). */
export function cellStatus(
  record: TrackedRecord,
  rule: ObligationRule,
  today: IsoDate,
): CellStatus {
  if (!ruleApplies(record, rule)) return "not_applicable";
  const triggerDate = record.triggers[rule.triggerField];
  const dueDate = computeDueDate(rule.cadence, triggerDate);

  if (rule.cadence.kind === "watch") return "not_applicable";
  if (!triggerDate && rule.cadence.kind !== "fixed_date") return "missing";
  if (!dueDate) return "missing";

  const d = diffDays(dueDate, today);
  // A one-off obligation whose deadline has passed (with a recorded date) is
  // completed, so it reads as valid rather than perpetually overdue.
  if (rule.oneOff && d < 0) return "valid";
  if (d < 0) return "overdue";

  // "due soon" window = the widest rung of this rule's own ladder.
  const window = rule.reminderLadderDays.length
    ? Math.max(...rule.reminderLadderDays)
    : 30;
  if (d <= window) return "due_soon";
  return "valid";
}

/** Order used everywhere the Today list is rendered. */
const BAND_ORDER: Record<UrgencyBand, number> = {
  overdue: 0,
  due_today: 1,
  start_soon: 2,
  watch: 3,
  later: 4,
};

export function sortForToday(a: Obligation, b: Obligation, today: IsoDate): number {
  const ba = BAND_ORDER[urgencyBand(a, today)];
  const bb = BAND_ORDER[urgencyBand(b, today)];
  if (ba !== bb) return ba - bb;
  // within a band, soonest due first; watch items last-ish
  const da = a.dueDate ? diffDays(a.dueDate, today) : Number.MAX_SAFE_INTEGER;
  const db = b.dueDate ? diffDays(b.dueDate, today) : Number.MAX_SAFE_INTEGER;
  return da - db;
}

/**
 * Enforce the once-a-year rent-increase rule (RENT_INCREASE_LIMIT).
 * Generic enough for any "no sooner than N months apart" business rule.
 * Returns an error message when blocked, or null when allowed.
 */
export function checkMinimumInterval(
  lastActionDate: IsoDate | undefined,
  proposedDate: IsoDate,
  minMonths: number,
  label = "action",
): string | null {
  if (!lastActionDate) return null;
  const earliest = addMonths(lastActionDate, minMonths);
  if (diffDays(proposedDate, earliest) < 0) {
    return `This ${label} is blocked: the previous one was on ${lastActionDate}. The next is not allowed until ${earliest} (minimum ${minMonths} months apart).`;
  }
  return null;
}

export type { ObligationStatus };
