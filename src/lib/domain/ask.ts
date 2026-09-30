import { type IsoDate } from "../rules/dates";
import { ruleApplies } from "../rules/engine";
import type { TrackedRecord } from "../rules/types";
import type { WorkspaceData } from "../data/types";
import { buildObligationViews, findUninsured } from "./views";
import { formatMoney } from "./format";

/**
 * "Ask" — question answering over the customer's OWN data only. Every answer
 * cites the records it used. This demo uses deterministic intent matching so it
 * runs with no LLM; in production the same shape is produced by retrieval over
 * the account's facts + documents, with the model constrained to cite sources.
 *
 * Read-only by design (spec ask.rules): it never mutates and never gives legal
 * advice as fact.
 */

export interface AskResult {
  answer: string;
  columns: string[];
  rows: { cells: string[]; recordId: string }[];
  note?: string;
  citationLabel: string;
}

const money = (r: TrackedRecord, key: string) =>
  typeof r.fields[key] === "number" ? Number(r.fields[key]) : 0;

export function ask(data: WorkspaceData, query: string, today: IsoDate): AskResult {
  const q = query.toLowerCase();

  // 1. Uninsured properties
  if (q.includes("uninsured") || (q.includes("without") && q.includes("insur"))) {
    const recs = findUninsured(data);
    return {
      answer: `${recs.length} ${data.workspace.recordNounPlural.toLowerCase()} have no active insurance on record.`,
      columns: [data.workspace.recordNoun, "Location"],
      rows: recs.map((r) => ({ cells: [r.label, r.sublabel ?? ""], recordId: r.id })),
      note: recs.length ? "A day uninsured is a day of total exposure." : undefined,
      citationLabel: `Source: ${recs.length} property records with no INSURANCE_END fact.`,
    };
  }

  // 2. Insurance ending before a month
  if (q.includes("insurance") && (q.includes("before") || q.includes("ending") || q.includes("renew"))) {
    const cutoff = extractMonthCutoff(q, today);
    const views = buildObligationViews(data, today).filter(
      (v) => v.category === "Insurance" && v.dueDate && v.dueDate <= cutoff,
    );
    return {
      answer: `${views.length} insurance renewals fall on or before ${cutoff}.`,
      columns: [data.workspace.recordNoun, "Renewal due"],
      rows: views.map((v) => ({ cells: [v.recordLabel, v.dueDate ?? ""], recordId: v.recordId })),
      citationLabel: `Source: INSURANCE_END facts across ${data.records.length} records.`,
    };
  }

  // 3. EPC D or worse
  if (q.includes("epc")) {
    const poor = ["D", "E", "F", "G"];
    const recs = data.records.filter((r) => poor.includes(String(r.fields.epc_rating)));
    const filtered = filterByBorough(recs, q);
    return {
      answer: `${filtered.length} ${data.workspace.recordNounPlural.toLowerCase()} are rated EPC D or below${boroughLabel(q)}.`,
      columns: [data.workspace.recordNoun, "EPC", "Rent (pcm)"],
      rows: filtered.map((r) => ({
        cells: [r.label, String(r.fields.epc_rating), formatMoney(money(r, "rent_pcm"))],
        recordId: r.id,
      })),
      note: "Minimum EPC C is proposed from 1 Oct 2030 (last verified 2026-09-30). Confirm with the PRS exemptions guidance before committing spend.",
      citationLabel: `Source: epc_rating field on ${data.records.length} records.`,
    };
  }

  // 4. Loan / mortgage outgoings next month
  if ((q.includes("loan") || q.includes("mortgage")) && (q.includes("month") || q.includes("out") || q.includes("payment"))) {
    const withMortgage = data.records.filter((r) => r.fields.has_mortgage === true);
    const byEntity = new Map<string, number>();
    for (const r of withMortgage) {
      const entity = String(r.fields.ownership_entity ?? "Unassigned");
      // demo: approximate monthly payment from rent
      byEntity.set(entity, (byEntity.get(entity) ?? 0) + Math.round(money(r, "rent_pcm") * 0.55));
    }
    return {
      answer: `Approx. loan payments next month across ${withMortgage.length} mortgaged ${data.workspace.recordNounPlural.toLowerCase()}, by owner.`,
      columns: ["Owner entity", "Est. monthly payment"],
      rows: [...byEntity.entries()].map(([entity, amt]) => ({ cells: [entity, formatMoney(amt)], recordId: "" })),
      note: "Estimated from rent in the demo. Connect Open Banking or loan statements for exact figures.",
      citationLabel: `Source: has_mortgage + rent_pcm on ${withMortgage.length} records.`,
    };
  }

  // 5. Fallback: keyword match against record labels
  const hits = data.records
    .filter((r) => r.label.toLowerCase().includes(q) || (r.sublabel ?? "").toLowerCase().includes(q))
    .slice(0, 20);
  return {
    answer: hits.length
      ? `${hits.length} ${data.workspace.recordNounPlural.toLowerCase()} match "${query}".`
      : `I can only answer from your own data. I couldn't map "${query}" to a known question. Try: "which properties are uninsured", "EPC D or worse in Hackney", or "loan payments next month".`,
    columns: [data.workspace.recordNoun, "Location"],
    rows: hits.map((r) => ({ cells: [r.label, r.sublabel ?? ""], recordId: r.id })),
    citationLabel: hits.length ? `Source: record labels.` : "No records cited.",
  };
}

function extractMonthCutoff(q: string, today: IsoDate): IsoDate {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const year = Number(today.slice(0, 4));
  for (let i = 0; i < months.length; i++) {
    if (q.includes(months[i]!)) {
      const mm = String(i + 1).padStart(2, "0");
      return `${year + (i + 1 < Number(today.slice(5, 7)) ? 1 : 0)}-${mm}-01`;
    }
  }
  // default: 90 days out
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 90));
  return dt.toISOString().slice(0, 10);
}

function filterByBorough(recs: TrackedRecord[], q: string): TrackedRecord[] {
  const boroughs = ["tower hamlets", "hackney", "newham", "southwark", "lambeth", "camden", "ealing"];
  const found = boroughs.find((b) => q.includes(b));
  if (!found) return recs;
  return recs.filter((r) => String(r.fields.borough).toLowerCase() === found);
}

function boroughLabel(q: string): string {
  const boroughs = ["tower hamlets", "hackney", "newham", "southwark", "lambeth", "camden", "ealing"];
  const found = boroughs.find((b) => q.includes(b));
  return found ? ` in ${found.replace(/\b\w/g, (c) => c.toUpperCase())}` : "";
}

export const askExamples = [
  "Which properties are uninsured?",
  "Insurance ending before December",
  "EPC D or worse in Hackney",
  "Loan payments next month by owner",
];
