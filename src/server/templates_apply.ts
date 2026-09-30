import { getTemplate } from "@/lib/data/templates";
import { seedLandlordRecords } from "@/lib/data/seed";
import type { CustomFieldDef } from "@/lib/data/types";
import { addField, createObject } from "./metadata";
import { createRecord } from "./records";
import type { AnyPgDb } from "./db/client";
import type { FieldType } from "./pipeline/fieldtypes";

/**
 * Materialise a v1 template (its record types + fields) into a workspace's
 * object_defs / field_defs, and optionally seed sample records (is_sample=true,
 * removable). This connects onboarding to the Phase 2 engine so a new workspace
 * has something in the grid.
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

export async function applyTemplateToWorkspace(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; templateId: string; withSamples?: boolean },
): Promise<{ objects: number; samples: number }> {
  if (!input.templateId || input.templateId === "blank") return { objects: 0, samples: 0 };
  let template;
  try {
    template = getTemplate(input.templateId);
  } catch {
    return { objects: 0, samples: 0 };
  }

  let objects = 0;
  let samples = 0;

  for (const rt of template.recordTypes) {
    const { objectId } = await createObject(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      apiName: rt.id,
      singularLabel: template.recordNoun,
      pluralLabel: template.recordNounPlural,
      titleFieldApiName: "name",
    });
    objects++;

    // Title field.
    await addField(db, {
      workspaceId: input.workspaceId, actorUserId: input.actorUserId, objectId,
      apiName: "name", label: `${template.recordNoun} name`, type: "text", required: true, position: 0,
    });

    let pos = 1;
    for (const f of rt.fields) {
      await addField(db, {
        workspaceId: input.workspaceId, actorUserId: input.actorUserId, objectId,
        apiName: f.key, label: f.label, type: mapFieldType(f.type, f.sensitive),
        config: f.type === "select" ? { options: (f.options ?? []).map((o) => ({ id: o, label: o })) } : undefined,
        filterable: ["select", "text", "boolean"].includes(f.type),
        position: pos++,
      });
    }

    // Seed a handful of sample records for the landlord flagship.
    if (input.withSamples && input.templateId === "uk-landlord" && rt.id === "property") {
      const fieldKeys = new Set(rt.fields.map((f) => f.key));
      const seed = seedLandlordRecords(25);
      for (const r of seed) {
        const rowInput: Record<string, unknown> = { name: r.label };
        for (const key of fieldKeys) {
          const v = r.fields[key];
          if (v !== undefined && v !== null && v !== "") rowInput[key] = v;
        }
        const res = await createRecord(db, {
          workspaceId: input.workspaceId, actorUserId: input.actorUserId, objectId,
          input: rowInput, isSample: true, source: "sample",
        });
        if (res.ok) samples++;
      }
    }
  }

  return { objects, samples };
}
