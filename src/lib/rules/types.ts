import type { IsoDate } from "./dates";

/**
 * Domain types for the obligation rules engine.
 *
 * The engine is deliberately generic: it knows nothing about gas certificates
 * or landlords. It turns a *trigger date* plus a *recurrence or offset* into
 * dated obligations with a reminder ladder. Landlord compliance, restaurant
 * hygiene, fleet MOTs — all of it is just data fed into this same engine.
 */

/** How the next due date is derived from the trigger date. */
export type Cadence =
  | { kind: "recurring_months"; every: number } // e.g. gas safety: 12
  | { kind: "recurring_years"; every: number } //  e.g. EICR: 5, EPC: 10
  | { kind: "offset_days"; days: number } //        e.g. deposit protection: within 30 days
  | { kind: "fixed_date"; date: IsoDate } //        e.g. a statutory deadline (PRS register)
  | { kind: "watch" }; //                           no due date yet; keep on radar

/**
 * A condition over a record's fields. Kept intentionally small and
 * serialisable so admins can build rules with no code (custom_types_fields_rules).
 */
export type Condition =
  | { field: string; op: "eq" | "neq"; value: string | number | boolean }
  | { field: string; op: "gt" | "gte" | "lt" | "lte"; value: number }
  | { field: string; op: "exists" }
  | { field: string; op: "in"; value: (string | number)[] }
  | { kind: "always" };

/**
 * A rule. Seeded from a template (uk_rules_seed) but fully editable by admins.
 * NEVER hard-coded in application logic — this is the whole point.
 */
export interface ObligationRule {
  code: string;
  title: string;
  /** Short human line shown to the user: "why it matters". */
  why: string;
  /** Which records this applies to. All conditions must hold (AND). */
  appliesWhen: Condition[];
  /**
   * The field on the record/fact that seeds the cadence.
   * For recurring rules this is the "last done" date (e.g. last inspection).
   * For offset rules this is the anchoring event (e.g. deposit received).
   */
  triggerField: string;
  cadence: Cadence;
  /** Days before due to fire reminders, e.g. [60,30,14,7,1]. */
  reminderLadderDays: number[];
  /** Whether marking done requires an uploaded document (evidence). */
  evidenceRequired: boolean;
  /**
   * A one-off obligation (deposit protection, right-to-rent) rather than a
   * recurring renewal. Once its deadline has passed with a recorded date it is
   * treated as completed, not overdue — a hard deadline you either met or not,
   * unlike a renewal that comes round again.
   */
  oneOff?: boolean;
  category: string; // grouping for the compliance matrix column
  sourceNote?: string;
  lastVerified?: IsoDate;
  enabled: boolean;
  /** Rules flagged for legal verification are created disabled with a note. */
  needsVerification?: boolean;
}

/** A tracked thing: a property, a vehicle, a location, an asset, a contract. */
export interface TrackedRecord {
  id: string;
  label: string; // human identifier, e.g. address or reg plate
  sublabel?: string; // e.g. postcode / borough
  recordTypeId: string;
  /** Arbitrary fields conditions can read, plus per-rule trigger dates. */
  fields: Record<string, string | number | boolean | null>;
  /**
   * Most recent known "done" date per rule code (from a confirmed document),
   * plus one-off anchor dates. Only *confirmed* facts land here.
   */
  triggers: Record<string, IsoDate | undefined>;
}

export type ObligationStatus =
  | "open"
  | "in_progress"
  | "done"
  | "snoozed"
  | "not_applicable";

export interface Obligation {
  id: string;
  ruleCode: string;
  recordId: string;
  title: string;
  why: string;
  category: string;
  dueDate: IsoDate | null; // null for pure "watch" items
  plannedDate?: IsoDate; // staff-scheduled date; never overrides legal dueDate
  reminderDates: IsoDate[]; // computed from the ladder
  status: ObligationStatus;
  assigneeId?: string;
  evidenceRequired: boolean;
  oneOff?: boolean;
  evidenceDocumentId?: string;
  snoozeReason?: string;
  snoozedUntil?: IsoDate;
  completedAt?: IsoDate;
  /** True when the trigger date came from an unconfirmed document. */
  provisional: boolean;
}

/** Cell status for the compliance matrix. */
export type CellStatus =
  | "valid"
  | "due_soon"
  | "overdue"
  | "missing"
  | "not_applicable";
