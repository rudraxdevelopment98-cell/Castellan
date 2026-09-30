import { and, asc, eq, isNull } from "drizzle-orm";
import { fieldDefs, objectDefs } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { appendAudit } from "./audit";
import { actorRoleInTx } from "./membership";
import { requireCap } from "./rbac";
import type { FieldDefLite, FieldType } from "./pipeline/fieldtypes";

/**
 * Metadata domain: customers define objects and fields at runtime (spec
 * metadata_engine). api_name is immutable; structural changes require
 * structure.manage. All scoped through the RLS query layer.
 */

const API_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

export interface NewObject {
  workspaceId: string;
  actorUserId: string;
  apiName: string;
  singularLabel: string;
  pluralLabel: string;
  icon?: string;
  titleFieldApiName?: string;
  description?: string;
  numberingPrefix?: string;
}

export async function createObject(db: AnyPgDb, input: NewObject): Promise<{ objectId: string }> {
  if (!API_NAME_RE.test(input.apiName)) {
    throw new Error("api_name must be lower_snake_case, starting with a letter.");
  }
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, input.workspaceId, input.actorUserId), "structure.manage");
    const [obj] = await tx
      .insert(objectDefs)
      .values({
        workspaceId: input.workspaceId,
        apiName: input.apiName,
        singularLabel: input.singularLabel,
        pluralLabel: input.pluralLabel,
        icon: input.icon ?? null,
        titleFieldApiName: input.titleFieldApiName ?? null,
        description: input.description ?? null,
        numberingPrefix: input.numberingPrefix ?? null,
      })
      .returning({ id: objectDefs.id });
    await appendAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "object.created",
      entity: "object",
      entityId: obj.id,
      after: { apiName: input.apiName },
    });
    return { objectId: obj.id as string };
  });
}

export interface NewField {
  workspaceId: string;
  actorUserId: string;
  objectId: string;
  apiName: string;
  label: string;
  type: FieldType;
  config?: Record<string, unknown>;
  required?: boolean;
  unique?: boolean;
  filterable?: boolean;
  defaultValue?: unknown;
  section?: string;
  position?: number;
  helpText?: string;
}

export async function addField(db: AnyPgDb, input: NewField): Promise<{ fieldId: string }> {
  if (!API_NAME_RE.test(input.apiName)) {
    throw new Error("api_name must be lower_snake_case, starting with a letter.");
  }
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, input.workspaceId, input.actorUserId), "structure.manage");
    const [field] = await tx
      .insert(fieldDefs)
      .values({
        workspaceId: input.workspaceId,
        objectId: input.objectId,
        apiName: input.apiName,
        label: input.label,
        type: input.type,
        config: input.config ?? null,
        required: input.required ?? false,
        unique: input.unique ?? false,
        filterable: input.filterable ?? false,
        defaultValue: input.defaultValue ?? null,
        section: input.section ?? null,
        position: input.position ?? 0,
        helpText: input.helpText ?? null,
      })
      .returning({ id: fieldDefs.id });
    await appendAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "field.created",
      entity: "field",
      entityId: field.id,
      after: { apiName: input.apiName, type: input.type },
    });
    return { fieldId: field.id as string };
  });
}

export interface ObjectWithFields {
  id: string;
  apiName: string;
  singularLabel: string;
  pluralLabel: string;
  titleFieldApiName: string | null;
  fields: FieldDefLite[];
}

/** Load an object and its (non-deleted) fields for the pipeline / UI. */
export async function getObjectByApiName(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; apiName: string },
): Promise<ObjectWithFields | null> {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    const [obj] = await tx.select().from(objectDefs).where(eq(objectDefs.apiName, input.apiName)).limit(1);
    if (!obj) return null;
    const fields = await tx
      .select()
      .from(fieldDefs)
      .where(and(eq(fieldDefs.objectId, obj.id), isNull(fieldDefs.deletedAt)))
      .orderBy(asc(fieldDefs.position));
    return mapObject(obj, fields);
  });
}

export async function getObjectById(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; objectId: string },
): Promise<ObjectWithFields | null> {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    const [obj] = await tx.select().from(objectDefs).where(eq(objectDefs.id, input.objectId)).limit(1);
    if (!obj) return null;
    const fields = await tx
      .select()
      .from(fieldDefs)
      .where(and(eq(fieldDefs.objectId, obj.id), isNull(fieldDefs.deletedAt)))
      .orderBy(asc(fieldDefs.position));
    return mapObject(obj, fields);
  });
}

export async function listObjects(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string },
) {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) =>
    tx
      .select({
        id: objectDefs.id,
        apiName: objectDefs.apiName,
        singularLabel: objectDefs.singularLabel,
        pluralLabel: objectDefs.pluralLabel,
      })
      .from(objectDefs)
      .where(isNull(objectDefs.archivedAt))
      .orderBy(asc(objectDefs.pluralLabel)),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapObject(obj: any, fields: any[]): ObjectWithFields {
  return {
    id: obj.id,
    apiName: obj.apiName,
    singularLabel: obj.singularLabel,
    pluralLabel: obj.pluralLabel,
    titleFieldApiName: obj.titleFieldApiName ?? null,
    fields: fields.map((f) => ({
      apiName: f.apiName,
      label: f.label,
      type: f.type as FieldType,
      required: f.required,
      unique: f.unique,
      config: f.config ?? undefined,
      defaultValue: f.defaultValue ?? undefined,
    })),
  };
}
