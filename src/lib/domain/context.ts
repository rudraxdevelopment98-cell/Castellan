import type { IsoDate } from "../rules/dates";
import { formatUkDate } from "../rules/dates";
import type { WorkspaceData } from "../data/types";
import { formatMoney } from "./format";
import {
  buildLookahead,
  buildMatrix,
  buildTodayPlan,
  findUninsured,
  buildObligationViews,
} from "./views";

/**
 * Builds the grounding context for the AI assistant: a compact, factual snapshot
 * of the workspace so Claude answers ONLY from the customer's own data. This is
 * the retrieval half of a small RAG — everything the model is allowed to cite.
 */
export function buildAssistantContext(data: WorkspaceData, today: IsoDate): string {
  const plan = buildTodayPlan(data, today);
  const matrix = buildMatrix(data, today);
  const lookahead = buildLookahead(data, today).slice(0, 10);
  const uninsured = findUninsured(data);
  const views = buildObligationViews(data, today);

  // Per-record next-due + overdue count.
  const agg = new Map<string, { next?: IsoDate; overdue: number }>();
  for (const v of views) {
    const e = agg.get(v.recordId) ?? { overdue: 0 };
    if (v.band === "overdue") e.overdue += 1;
    if (v.dueDate && (!e.next || v.dueDate < e.next)) e.next = v.dueDate;
    agg.set(v.recordId, e);
  }

  const L: string[] = [];
  L.push(`WORKSPACE: ${data.workspace.name} (template: ${data.template.name})`);
  L.push(`RECORD TYPE: ${data.workspace.recordNoun} / ${data.workspace.recordNounPlural}`);
  L.push(`TODAY: ${today} (${formatUkDate(today)})`);
  L.push(`DATA REGION: ${data.workspace.dataRegion}`);
  L.push("");

  L.push(`TOTALS: ${data.records.length} ${data.workspace.recordNounPlural.toLowerCase()}, ` +
    `${plan.counts.overdue} overdue today, ${plan.counts.total} on today's plan.`);
  L.push(`MATRIX CELLS: valid ${matrix.totals.valid}, due_soon ${matrix.totals.due_soon}, ` +
    `overdue ${matrix.totals.overdue}, missing ${matrix.totals.missing}, n/a ${matrix.totals.not_applicable}.`);
  L.push("");

  if (uninsured.length) {
    L.push(`UNINSURED (no active insurance on record): ` +
      uninsured.map((r) => `${r.label} (${r.sublabel})`).join("; "));
    L.push("");
  }

  L.push("OVERDUE OBLIGATIONS:");
  for (const o of plan.overdue.slice(0, 40)) {
    L.push(`- ${o.title} @ ${o.recordLabel} ${o.recordSublabel ?? ""} — due ${o.dueDate} (${o.category})`);
  }
  if (plan.overdue.length === 0) L.push("- none");
  L.push("");

  L.push("DUE / ACTION TODAY:");
  for (const o of [...plan.dueToday, ...plan.startSoon].slice(0, 40)) {
    L.push(`- ${o.title} @ ${o.recordLabel} — due ${o.dueDate} (${o.category})`);
  }
  L.push("");

  L.push("NEXT 90 DAYS (clusters):");
  for (const c of lookahead) L.push(`- ${c.count} × ${c.category} in ${c.month}`);
  L.push("");

  L.push("RULES (all dates editable; verify before decisions):");
  for (const r of data.template.rules) {
    L.push(`- ${r.code}: ${r.title} — ${r.why}` +
      (r.lastVerified ? ` [last verified ${r.lastVerified}]` : "") +
      (r.needsVerification ? " [NEEDS VERIFICATION]" : ""));
  }
  L.push("");

  // Compact record index — one line each, so specific-record questions are grounded.
  L.push(`${data.workspace.recordNounPlural.toUpperCase()} INDEX (id | label | postcode | borough | type | epc | rent | flags | next due | overdue):`);
  for (const r of data.records) {
    const e = agg.get(r.id) ?? { overdue: 0 };
    const flags = [
      r.fields.has_gas ? "gas" : "",
      r.fields.is_hmo ? "hmo" : "",
      r.fields.has_mortgage ? "mortgage" : "",
    ].filter(Boolean).join(",");
    L.push(
      `${r.id} | ${r.label} | ${r.fields.postcode ?? ""} | ${r.fields.borough ?? ""} | ` +
      `${r.fields.type ?? r.recordTypeId} | ${r.fields.epc_rating ?? "-"} | ` +
      `${r.fields.rent_pcm ? formatMoney(Number(r.fields.rent_pcm)) : "-"} | ${flags || "-"} | ` +
      `${e.next ? formatUkDate(e.next) : "-"} | ${e.overdue}`,
    );
  }

  return L.join("\n");
}

export const ASSISTANT_SYSTEM_INSTRUCTIONS = `You are the assistant inside Castellan, a document-and-deadline operations desk. You help the owner and their staff understand their portfolio.

Rules you must follow:
- Answer ONLY from the DATA snapshot provided below. It is the user's own data. Never invent properties, dates, amounts or facts that are not in the data.
- When you reference specific records, name them by their label/address exactly as in the data, so the user can find them. Prefer a short table or bullet list for multiple results.
- If the answer isn't in the data, say what is missing and suggest where to add it (e.g. "upload the insurance schedule"). Do not guess.
- Dates: write as "14 Oct 2027". Money: write as "GBP 1,200". Never use ambiguous formats like 03/04.
- Do NOT give legal or tax advice as fact. When a rule is involved, mention its last-verified date and suggest confirming with a qualified solicitor or accountant before decisions.
- Be calm, exact and concise — the voice of a trusted steward. No hype, no emoji, no exclamation marks.
- You are read-only. If the user asks you to change data, assign tasks or send reminders, explain that they need to confirm that action in the app; you can describe exactly what to do.`;
