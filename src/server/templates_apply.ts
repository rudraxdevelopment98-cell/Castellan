import { getTemplate } from "@/lib/data/templates";
import { seedLandlordRecords } from "@/lib/data/seed";
import { addYears } from "@/lib/rules/dates";
import type { CustomFieldDef } from "@/lib/data/types";
import { addField, createObject } from "./metadata";
import { createRecord } from "./records";
import { createRule } from "./rules_admin";
import { regenerateObligations } from "./obligations_gen";
import type { AnyPgDb } from "./db/client";
import type { FieldType } from "./pipeline/fieldtypes";

/**
 * Materialise a v1 template into a workspace's object_defs / field_defs (+ sample
 * records), and — for the landlord flagship — the compliance date fields and the
 * obligation rules, then generate obligations. This reproduces the v1 prototype's
 * behaviour on real engine data (Phase 4 exit criterion).
 */

function mapFieldType(t: CustomFieldDef["type"], sensitive?: boolean): FieldType {
  if (sensitive) return "sensitive_text";
  switch (t) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "date": return "date";
    case "select": return "single_select";
    default: return "text";
  }
}

// Compliance date fields added to the landlord property object (the triggers).
const LANDLORD_DATE_FIELDS = [
  { apiName: "gas_last_check", label: "Gas safety — last check" },
  { apiName: "eicr_last_check", label: "EICR — last inspection" },
  { apiName: "epc_expiry", label: "EPC — expiry" },
  { apiName: "insurance_end", label: "Insurance — renewal date" },
];

const V = "2026-09-30";

export async function applyTemplateToWorkspace(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; templateId: string; withSamples?: boolean },
): Promise<{ objects: number; samples: number; rules: number }> {
  if (!input.templateId || input.templateId === "blank") return { objects: 0, samples: 0, rules: 0 };
  let template;
  try {
    template = getTemplate(input.templateId);
  } catch {
    return { objects: 0, samples: 0, rules: 0 };
  }

  const base = { workspaceId: input.workspaceId, actorUserId: input.actorUserId };
  let objects = 0;
  let samples = 0;
  let ruleCount = 0;
  const isLandlord = input.templateId === "uk-landlord";

  for (const rt of template.recordTypes) {
    const { objectId } = await createObject(db, {
      ...base, apiName: rt.id, singularLabel: template.recordNoun,
      pluralLabel: template.recordNounPlural, titleFieldApiName: "name",
    });
    objects++;

    await addField(db, { ...base, objectId, apiName: "name", label: `${template.recordNoun} name`, type: "text", required: true, position: 0 });

    let pos = 1;
    for (const f of rt.fields) {
      await addField(db, {
        ...base, objectId, apiName: f.key, label: f.label, type: mapFieldType(f.type, f.sensitive),
        config: f.type === "select" ? { options: (f.options ?? []).map((o) => ({ id: o, label: o })) } : undefined,
        filterable: ["select", "text", "boolean"].includes(f.type), position: pos++,
      });
    }

    const landlordProperty = isLandlord && rt.id === "property";
    if (landlordProperty) {
      for (const d of LANDLORD_DATE_FIELDS) {
        await addField(db, { ...base, objectId, apiName: d.apiName, label: d.label, type: "date", position: pos++ });
      }
    }

    // Sample records.
    if (input.withSamples && landlordProperty) {
      const fieldKeys = new Set(rt.fields.map((f) => f.key));
      const seed = seedLandlordRecords(25);
      for (const r of seed) {
        const rowInput: Record<string, unknown> = { name: r.label };
        for (const key of fieldKeys) {
          const v = r.fields[key];
          if (v !== undefined && v !== null && v !== "") rowInput[key] = v;
        }
        // Compliance trigger dates from the seed.
        if (r.triggers.GAS_SAFETY) rowInput.gas_last_check = r.triggers.GAS_SAFETY;
        if (r.triggers.EICR) rowInput.eicr_last_check = r.triggers.EICR;
        if (r.triggers.INSURANCE_END) rowInput.insurance_end = r.triggers.INSURANCE_END;
        if (r.triggers.EPC) rowInput.epc_expiry = addYears(r.triggers.EPC, 10);
        const res = await createRecord(db, { ...base, objectId, input: rowInput, isSample: true, source: "sample" });
        if (res.ok) samples++;
      }
    }

    // Compliance rules (landlord flagship) — the v1 rule pack, now as workspace rules.
    if (landlordProperty) {
      const defs = [
        { code: "GAS_SAFETY", title: "Gas safety check", why: "Annual legal duty; a lapse voids cover and blocks possession.", appliesWhen: [{ field: "has_gas", op: "eq" as const, value: true }], triggerField: "gas_last_check", cadence: { kind: "recurring_months" as const, every: 12 }, reminderLadder: [60, 30, 14, 7, 1], category: "Gas" },
        { code: "EICR", title: "Electrical report (EICR)", why: "Five-year electrical safety report.", appliesWhen: [{ kind: "always" as const }], triggerField: "eicr_last_check", cadence: { kind: "recurring_years" as const, every: 5 }, reminderLadder: [120, 60, 30, 14, 7], category: "Electric" },
        { code: "EPC", title: "Energy certificate (EPC)", why: "Valid 10 years; minimum rating applies.", appliesWhen: [{ kind: "always" as const }], triggerField: "epc_expiry", cadence: { kind: "offset_days" as const, days: 0 }, reminderLadder: [180, 90, 30], category: "EPC" },
        { code: "INSURANCE", title: "Insurance renewal", why: "A day uninsured is a day of total exposure.", appliesWhen: [{ kind: "always" as const }], triggerField: "insurance_end", cadence: { kind: "offset_days" as const, days: 0 }, reminderLadder: [60, 30, 14, 7, 1], category: "Insurance" },
      ];
      for (const d of defs) {
        await createRule(db, { ...base, objectId, ...d, evidenceRequired: true, lastVerified: V });
        ruleCount++;
      }
    }
  }

  if (ruleCount > 0) await regenerateObligations(db, base);
  return { objects, samples, rules: ruleCount };
}
