import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffDays,
  formatUkDate,
  isLeapYear,
  isValidIsoDate,
  todayInLondon,
} from "./dates";
import {
  cellStatus,
  checkMinimumInterval,
  computeDueDate,
  computeReminderDates,
  evaluateCondition,
  generateObligation,
  nextCycle,
  ruleApplies,
  sortForToday,
  urgencyBand,
} from "./engine";
import type { ObligationRule, TrackedRecord } from "./types";

// ---------------------------------------------------------------------------
// Date arithmetic — the foundation. If these are wrong, everything is wrong.
// ---------------------------------------------------------------------------

describe("date arithmetic", () => {
  it("adds months with month-end clamping (Jan 31 + 1m => Feb 28)", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
  });

  it("clamps into a leap February (Jan 31 2024 + 1m => Feb 29)", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("gas-safety cycle: 10 Oct 2026 + 12 months => 10 Oct 2027", () => {
    // Acceptance test from the spec.
    expect(addMonths("2026-10-10", 12)).toBe("2027-10-10");
  });

  it("EICR 5-year cycle preserves the day", () => {
    expect(addYears("2025-03-15", 5)).toBe("2030-03-15");
  });

  it("EPC 10-year cycle across a leap boundary (29 Feb)", () => {
    // 29 Feb 2024 + 10 years -> 28 Feb 2034 (2034 not a leap year)
    expect(addYears("2024-02-29", 10)).toBe("2034-02-28");
  });

  it("addMonths rolls the year over correctly", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("addMonths handles negative months", () => {
    expect(addMonths("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonths("2027-01-15", -13)).toBe("2025-12-15");
  });

  it("addDays crosses the BST spring-forward without dropping a day", () => {
    // 2026 BST begins Sun 29 Mar. Date-only maths must be immune.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("addDays crosses the BST autumn fall-back cleanly", () => {
    // 2026 BST ends Sun 25 Oct.
    expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
  });

  it("diffDays counts whole calendar days across a DST change", () => {
    expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
    expect(diffDays("2026-10-27", "2026-10-24")).toBe(3);
  });

  it("knows leap years and month lengths", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
  });

  it("validates ISO dates including impossible days", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-10-10")).toBe(true);
  });

  it("formats UK dates unambiguously", () => {
    expect(formatUkDate("2027-10-14")).toBe("14 Oct 2027");
    expect(formatUkDate("2026-04-03")).toBe("3 Apr 2026");
  });

  it("todayInLondon returns a valid ISO date regardless of host TZ", () => {
    const t = todayInLondon(new Date("2026-06-15T23:30:00Z"));
    expect(isValidIsoDate(t)).toBe(true);
    // At 23:30 UTC in June, London is BST (+1) so it's already the 16th.
    expect(t).toBe("2026-06-16");
  });
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<TrackedRecord> = {}): TrackedRecord {
  return {
    id: "r1",
    label: "22 Cable Street",
    sublabel: "E1 8JG",
    recordTypeId: "property",
    fields: { has_gas: true, is_hmo: false, epc_rating: "D" },
    triggers: { GAS_SAFETY: "2026-10-10" },
    ...overrides,
  };
}

const gasRule: ObligationRule = {
  code: "GAS_SAFETY",
  title: "Gas safety check",
  why: "Legal duty; a lapse voids cover and blocks possession claims.",
  appliesWhen: [{ field: "has_gas", op: "eq", value: true }],
  triggerField: "GAS_SAFETY",
  cadence: { kind: "recurring_months", every: 12 },
  reminderLadderDays: [60, 30, 14, 7, 1],
  evidenceRequired: true,
  category: "Gas",
  enabled: true,
};

// ---------------------------------------------------------------------------
// Conditions & applicability
// ---------------------------------------------------------------------------

describe("conditions", () => {
  it("eq / neq / exists", () => {
    const r = makeRecord();
    expect(evaluateCondition(r, { field: "has_gas", op: "eq", value: true })).toBe(true);
    expect(evaluateCondition(r, { field: "is_hmo", op: "eq", value: true })).toBe(false);
    expect(evaluateCondition(r, { field: "GAS_SAFETY", op: "exists" })).toBe(true);
    expect(evaluateCondition(r, { field: "nope", op: "exists" })).toBe(false);
  });

  it("in / numeric comparisons", () => {
    const r = makeRecord({ fields: { epc_rating: "D", bedrooms: 4 } });
    expect(evaluateCondition(r, { field: "epc_rating", op: "in", value: ["D", "E", "F", "G"] })).toBe(true);
    expect(evaluateCondition(r, { field: "bedrooms", op: "gte", value: 5 })).toBe(false);
    expect(evaluateCondition(r, { field: "bedrooms", op: "lt", value: 5 })).toBe(true);
  });

  it("rule applies only when all conditions hold and rule is enabled", () => {
    expect(ruleApplies(makeRecord(), gasRule)).toBe(true);
    const noGas = makeRecord({ fields: { has_gas: false } });
    expect(ruleApplies(noGas, gasRule)).toBe(false);
    expect(ruleApplies(makeRecord(), { ...gasRule, enabled: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Obligation generation — the spec's headline acceptance test
// ---------------------------------------------------------------------------

describe("obligation generation", () => {
  it("a gas record dated 10 Oct 2026 creates a check due 10 Oct 2027 with the right ladder", () => {
    const ob = generateObligation(makeRecord(), gasRule);
    expect(ob).not.toBeNull();
    expect(ob!.dueDate).toBe("2027-10-10");
    // ladder 60/30/14/7/1 counting back from the due date, ascending
    expect(ob!.reminderDates).toEqual([
      "2027-08-11", // -60
      "2027-09-10", // -30
      "2027-09-26", // -14
      "2027-10-03", // -7
      "2027-10-09", // -1
    ]);
    expect(ob!.evidenceRequired).toBe(true);
  });

  it("returns null when the rule does not apply", () => {
    const noGas = makeRecord({ fields: { has_gas: false } });
    expect(generateObligation(noGas, gasRule)).toBeNull();
  });

  it("offset rules: deposit protection within 30 days of receipt", () => {
    const due = computeDueDate({ kind: "offset_days", days: 30 }, "2026-05-01");
    expect(due).toBe("2026-05-31");
  });

  it("fixed-date rules ignore the trigger (statutory deadline)", () => {
    const due = computeDueDate({ kind: "fixed_date", date: "2027-10-14" }, undefined);
    expect(due).toBe("2027-10-14");
  });

  it("watch rules have no due date", () => {
    expect(computeDueDate({ kind: "watch" }, "2026-01-01")).toBeNull();
  });

  it("completing with a new date produces the next cycle without touching history", () => {
    const record = makeRecord();
    const next = nextCycle(record, gasRule, "2027-10-09");
    // original untouched
    expect(record.triggers.GAS_SAFETY).toBe("2026-10-10");
    // next cycle is 12 months from the new certificate date
    expect(next!.dueDate).toBe("2028-10-09");
  });

  it("changing a rule's reminder ladder changes future reminders only", () => {
    const relaxed = { ...gasRule, reminderLadderDays: [90, 30] };
    const ob = generateObligation(makeRecord(), relaxed);
    expect(ob!.reminderDates).toEqual(["2027-07-12", "2027-09-10"]);
  });
});

// ---------------------------------------------------------------------------
// Urgency banding & matrix status
// ---------------------------------------------------------------------------

describe("urgency and matrix", () => {
  it("bands overdue / due today / start soon / later", () => {
    const ob = generateObligation(makeRecord(), gasRule)!; // due 2027-10-10, rungs incl. 2027-08-11
    expect(urgencyBand(ob, "2027-10-11")).toBe("overdue");
    expect(urgencyBand(ob, "2027-10-10")).toBe("due_today");
    expect(urgencyBand(ob, "2027-08-11")).toBe("start_soon"); // a reminder rung fires today (-60)
    expect(urgencyBand(ob, "2027-08-15")).toBe("later"); // window open, but no rung today
    expect(urgencyBand(ob, "2027-01-01")).toBe("later"); // long before any reminder
  });

  it("matrix cell status reflects validity windows and applicability", () => {
    const r = makeRecord(); // due 2027-10-10, widest ladder rung = 60
    expect(cellStatus(r, gasRule, "2026-11-01")).toBe("valid");
    expect(cellStatus(r, gasRule, "2027-09-01")).toBe("due_soon"); // within 60 days
    expect(cellStatus(r, gasRule, "2027-11-01")).toBe("overdue");

    const noGas = makeRecord({ fields: { has_gas: false } });
    expect(cellStatus(noGas, gasRule, "2026-11-01")).toBe("not_applicable");

    const noRecordYet = makeRecord({ triggers: {} });
    expect(cellStatus(noRecordYet, gasRule, "2026-11-01")).toBe("missing");
  });

  it("a one-off obligation past its deadline reads as completed, not overdue", () => {
    const depositRule: ObligationRule = {
      code: "DEPOSIT",
      title: "Protect deposit",
      why: "Within 30 days.",
      appliesWhen: [{ kind: "always" }],
      triggerField: "DEPOSIT",
      cadence: { kind: "offset_days", days: 30 },
      reminderLadderDays: [10, 3, 1],
      evidenceRequired: true,
      oneOff: true,
      category: "Deposit",
      enabled: true,
    };
    // Protected long ago: due date well in the past -> valid, not overdue.
    const done = makeRecord({ triggers: { DEPOSIT: "2025-01-01" } });
    expect(cellStatus(done, depositRule, "2026-09-30")).toBe("valid");
    expect(urgencyBand(generateObligation(done, depositRule)!, "2026-09-30")).toBe("later");
    // Clock still running, inside the 10-day ladder window -> shows as active.
    const running = makeRecord({ triggers: { DEPOSIT: "2026-09-06" } }); // due 2026-10-06 (6 days out)
    expect(cellStatus(running, depositRule, "2026-09-30")).toBe("due_soon");
  });

  it("sorts overdue before due-today before start-soon", () => {
    const overdue = { ...generateObligation(makeRecord(), gasRule)!, id: "a" };
    const later = {
      ...generateObligation(
        makeRecord({ triggers: { GAS_SAFETY: "2027-06-01" } }),
        gasRule,
      )!,
      id: "b",
    };
    const today = "2027-10-10"; // overdue is due 2027-10-10 => due_today; later due 2028-06-01
    const sorted = [later, overdue].sort((x, y) => sortForToday(x, y, today));
    expect(sorted[0]!.id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Minimum-interval guard (rent increase once a year, generalised)
// ---------------------------------------------------------------------------

describe("minimum interval guard", () => {
  it("blocks a second rent increase within 12 months", () => {
    const msg = checkMinimumInterval("2026-05-01", "2026-11-01", 12, "rent increase");
    expect(msg).toContain("blocked");
    expect(msg).toContain("2027-05-01");
  });

  it("allows one exactly 12 months later", () => {
    expect(checkMinimumInterval("2026-05-01", "2027-05-01", 12)).toBeNull();
  });

  it("allows the first ever action (no prior date)", () => {
    expect(checkMinimumInterval(undefined, "2026-05-01", 12)).toBeNull();
  });
});

describe("reminder date generation edge cases", () => {
  it("filters negative ladder entries and sorts ascending", () => {
    expect(computeReminderDates("2027-10-10", [30, -5, 7])).toEqual([
      "2027-09-10",
      "2027-10-03",
    ]);
  });
});
