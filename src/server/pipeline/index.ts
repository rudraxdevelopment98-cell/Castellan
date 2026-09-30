import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { memberships, records } from "../db/schema";
import { processField, type FieldDefLite, type FieldError } from "./fieldtypes";

/**
 * Pre-processing pipeline (spec data_processing_pipeline). Runs sanitise ->
 * normalise -> validate (via the field registry) -> duplicate/existence checks
 * -> enrich (title, links). Authorise is done by the caller (records.ts) which
 * knows the actor's role. Every source — UI, import, API — goes through this so
 * data is consistent regardless of origin.
 */

// tx is the scoped drizzle transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface PipelineInput {
  object: { id: string; titleFieldApiName?: string | null };
  fields: FieldDefLite[];
  input: Record<string, unknown>;
  workspaceId: string;
  mode: "create" | "update";
  recordId?: string;
}

export interface PipelineResult {
  ok: boolean;
  data: Record<string, unknown>;
  title: string | null;
  links: { fieldApiName: string; toIds: string[] }[];
  errors: FieldError[];
}

export async function runPreProcessing(tx: Tx, input: PipelineInput): Promise<PipelineResult> {
  const data: Record<string, unknown> = {};
  const links: { fieldApiName: string; toIds: string[] }[] = [];
  const errors: FieldError[] = [];

  for (const field of input.fields) {
    if (field.type === "auto_number") continue; // engine-generated

    // On create, fall back to the default; on update, only touch provided fields.
    let raw = input.input[field.apiName];
    const provided = Object.prototype.hasOwnProperty.call(input.input, field.apiName);
    if (!provided) {
      if (input.mode === "update") continue;
      raw = field.defaultValue ?? undefined;
    }

    const res = processField(raw, field);
    if (!res.ok) {
      errors.push(res.error);
      continue;
    }
    data[field.apiName] = res.value;

    // Relation/person links are stored in record_links; keep the ids here too.
    if ((field.type === "relation" || field.type === "person") && res.value != null) {
      const ids = Array.isArray(res.value) ? (res.value as string[]) : [res.value as string];
      links.push({ fieldApiName: field.apiName, toIds: ids });
    }
  }

  // Duplicate detection for unique fields.
  for (const field of input.fields) {
    if (!field.unique) continue;
    const value = data[field.apiName];
    if (value === undefined || value === null) continue;
    const dupWhere = [
      eq(records.workspaceId, input.workspaceId),
      eq(records.objectId, input.object.id),
      isNull(records.deletedAt),
      sql`(${records.data} ->> ${field.apiName}) = ${String(value)}`,
    ];
    if (input.recordId) dupWhere.push(ne(records.id, input.recordId));
    const hit = await tx.select({ id: records.id }).from(records).where(and(...dupWhere)).limit(1);
    if (hit[0]) {
      errors.push({
        field: field.apiName,
        code: "duplicate",
        message: `${field.label} must be unique; another record already has this value.`,
        valueReceived: value,
      });
    }
  }

  // Relation / person existence + scope.
  for (const link of links) {
    const field = input.fields.find((f) => f.apiName === link.fieldApiName)!;
    for (const id of link.toIds) {
      if (field.type === "person") {
        const m = await tx
          .select({ id: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, id)))
          .limit(1);
        if (!m[0]) {
          errors.push({ field: field.apiName, code: "not_a_member", message: `${field.label} must reference a workspace member.`, valueReceived: id });
        }
      } else {
        const r = await tx
          .select({ id: records.id, objectId: records.objectId })
          .from(records)
          .where(and(eq(records.workspaceId, input.workspaceId), eq(records.id, id), isNull(records.deletedAt)))
          .limit(1);
        const target = field.config?.targetObject as string | undefined;
        if (!r[0]) {
          errors.push({ field: field.apiName, code: "missing_relation", message: `${field.label} points to a record that doesn't exist.`, valueReceived: id });
        } else if (target && r[0].objectId !== target) {
          errors.push({ field: field.apiName, code: "wrong_relation_target", message: `${field.label} must link to the correct object.`, valueReceived: id });
        }
      }
    }
  }

  // Enrich: derive the record title from the configured title field.
  let title: string | null = null;
  if (input.object.titleFieldApiName && data[input.object.titleFieldApiName] != null) {
    title = String(data[input.object.titleFieldApiName]);
  }

  return { ok: errors.length === 0, data, title, links, errors };
}
