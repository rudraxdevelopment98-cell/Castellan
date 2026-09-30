import { type IsoDate } from "../rules/dates";
import type { WorkspaceData } from "../data/types";
import { formatMoney, pluralize } from "./format";
import { buildTodayPlan, findUninsured, type ObligationView } from "./views";

/**
 * Notification composition. The rule (spec notifications.principle): at 500
 * properties, one alert per item is spam. Everything is digested into ONE
 * morning brief; only true urgencies would be sent individually.
 *
 * This module produces the *content*; channel delivery (WhatsApp/email/push)
 * is wired in production via the providers in .env.example.
 */

export interface MorningBrief {
  greeting: string;
  headline: string;
  lines: string[];
  money: { in: number; out: number };
}

export function composeMorningBrief(data: WorkspaceData, today: IsoDate): MorningBrief {
  const plan = buildTodayPlan(data, today);
  const lines: string[] = [];

  // Group today's items by category for a compact digest.
  const grouped = groupByCategory([...plan.overdue, ...plan.dueToday, ...plan.startSoon]);

  // Lead with the sharpest overdue items, named individually (max 2).
  for (const ob of plan.overdue.slice(0, 2)) {
    lines.push(`Overdue: ${ob.title} at ${ob.recordLabel} ${ob.recordSublabel ?? ""} (due ${ob.dueDate}).`);
  }

  // Then digest the rest by type.
  for (const [category, items] of grouped) {
    if (items.length === 0) continue;
    lines.push(`${pluralize(items.length, category + " item")} to handle.`);
  }

  // Uninsured is always its own critical line.
  const uninsured = findUninsured(data);
  if (uninsured.length) {
    lines.push(`Critical: ${pluralize(uninsured.length, data.workspace.recordNoun.toLowerCase())} with no insurance on record.`);
  }

  // Money line (rent expected vs loan payments out — demo estimates).
  const rentIn = sum(data.records.map((r) => num(r.fields.rent_pcm) / 30)); // rough daily
  const loanOut = sum(
    data.records.filter((r) => r.fields.has_mortgage).map((r) => (num(r.fields.rent_pcm) * 0.55) / 30),
  );

  return {
    greeting: "Good morning.",
    headline:
      plan.counts.total === 0
        ? "Nothing needs your attention today."
        : `${pluralize(plan.counts.total, "thing")} today, ${plan.counts.overdue} overdue.`,
    lines,
    money: { in: Math.round(rentIn), out: Math.round(loanOut) },
  };
}

export function renderBriefText(brief: MorningBrief): string {
  const parts = [
    `${brief.greeting} ${brief.headline}`,
    ...brief.lines,
    `Money: ${formatMoney(brief.money.in)} rent expected, ${formatMoney(brief.money.out)} loan payments out.`,
    "Open today's list →",
  ];
  return parts.join("\n");
}

function groupByCategory(items: ObligationView[]): Map<string, ObligationView[]> {
  const m = new Map<string, ObligationView[]>();
  for (const it of items) {
    if (!m.has(it.category)) m.set(it.category, []);
    m.get(it.category)!.push(it);
  }
  return m;
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
