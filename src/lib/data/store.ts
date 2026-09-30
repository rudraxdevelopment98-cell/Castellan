import { addDays, addMonths, addYears, type IsoDate } from "../rules/dates";
import type { Cadence, TrackedRecord } from "../rules/types";
import { seedLandlordDocuments, seedLandlordRecords, demoUsers } from "./seed";
import { getTemplate } from "./templates";
import type { TrackedDocument, User, Workspace, WorkspaceData } from "./types";

/**
 * In-memory data access for the Phase-1 demo. One function per read the UI
 * needs. In production these become Postgres queries scoped by account_id
 * with row-level security; the function signatures would not change.
 *
 * Cached per template so repeated page renders are cheap and stable.
 */

const cache = new Map<string, WorkspaceData>();

export const DEFAULT_TEMPLATE_ID = "uk-landlord";

function buildLandlord(): WorkspaceData {
  const template = getTemplate("uk-landlord");
  const records = seedLandlordRecords(520);
  const documents = seedLandlordDocuments(records);
  const workspace: Workspace = {
    id: "ws_demo",
    name: "Whitmore portfolio",
    templateId: template.id,
    dataRegion: "eu-west-2",
    recordNoun: template.recordNoun,
    recordNounPlural: template.recordNounPlural,
  };
  return { workspace, template, users: demoUsers, records, documents };
}

/** A small synthetic dataset for the non-landlord templates (proof of reuse). */
function buildGeneric(templateId: string): WorkspaceData {
  const template = getTemplate(templateId);
  const today: IsoDate = "2026-09-30";

  // A spread of wanted due-date offsets (days from today): some overdue, some
  // due today, some soon. We invert each rule's cadence to find the trigger
  // date that produces that due date — so every template has a live Today.
  const WANTED = [-6, 0, 4, 12, -2, 30, 60, 3];

  const triggerForDue = (cadence: Cadence, dueOffsetDays: number): IsoDate | undefined => {
    const due = addDays(today, dueOffsetDays);
    switch (cadence.kind) {
      case "recurring_months": return addMonths(due, -cadence.every);
      case "recurring_years": return addYears(due, -cadence.every);
      case "offset_days": return addDays(due, -cadence.days);
      case "fixed_date": return undefined; // due is fixed; no trigger needed
      case "watch": return undefined;
    }
  };

  const records: TrackedRecord[] = Array.from({ length: 8 }).map((_, i) => ({
    id: `${templateId}-r${i + 1}`,
    label: `${template.recordNoun} ${i + 1}`,
    sublabel: template.recordTypes[0]?.name,
    recordTypeId: template.recordTypes[0]?.id ?? "record",
    fields: { sells_alcohol: i % 2 === 0 },
    triggers: Object.fromEntries(
      template.rules
        .map((rule, j) => {
          const wanted = WANTED[(i + j) % WANTED.length]!;
          return [rule.triggerField, triggerForDue(rule.cadence, wanted)] as const;
        })
        .filter(([, v]) => v !== undefined),
    ),
  }));
  const workspace: Workspace = {
    id: `ws_${templateId}`,
    name: `${template.name} demo`,
    templateId: template.id,
    dataRegion: "eu-west-2",
    recordNoun: template.recordNoun,
    recordNounPlural: template.recordNounPlural,
  };
  return { workspace, template, users: demoUsers, records, documents: [] };
}

export function getWorkspaceData(templateId = DEFAULT_TEMPLATE_ID): WorkspaceData {
  const cached = cache.get(templateId);
  if (cached) return cached;
  const data = templateId === "uk-landlord" ? buildLandlord() : buildGeneric(templateId);
  cache.set(templateId, data);
  return data;
}

export function getRecord(templateId: string, recordId: string): TrackedRecord | undefined {
  return getWorkspaceData(templateId).records.find((r) => r.id === recordId);
}

export function getDocument(templateId: string, docId: string): TrackedDocument | undefined {
  return getWorkspaceData(templateId).documents.find((d) => d.id === docId);
}

export function getUser(templateId: string, userId: string): User | undefined {
  return getWorkspaceData(templateId).users.find((u) => u.id === userId);
}
