import { and, asc, desc, eq, isNull, isNotNull } from "drizzle-orm";
import {
  fieldDefs,
  memberships,
  objectDefs,
  outbox,
  recordHistory,
  recordLinks,
  records,
} from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { actorRoleInTx } from "./membership";
import { requireCap, type Role } from "./rbac";
import { runPreProcessing } from "./pipeline";
import type { FieldDefLite, FieldError, FieldType } from "./pipeline/fieldtypes";

/**
 * Records domain: create / update / soft-delete through the shared pre-processing
 * pipeline, with field-level history diffs, optimistic locking and an outbox
 * event written in the SAME transaction (spec data_processing_pipeline: nothing
 * is lost if a worker crashes). Reads honour the member's record scope.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function loadObjectInTx(tx: Tx, objectId: string) {
  const [obj] = await tx.select().from(objectDefs).where(eq(objectDefs.id, objectId)).limit(1);
  if (!obj) return null;
  const fields = await tx
    .select()
    .from(fieldDefs)
    .where(and(eq(fieldDefs.objectId, objectId), isNull(fieldDefs.deletedAt)))
    .orderBy(asc(fieldDefs.position));
  const lite: FieldDefLite[] = fields.map((f: any) => ({
    apiName: f.apiName,
    label: f.label,
    type: f.type as FieldType,
    required: f.required,
    unique: f.unique,
    config: f.config ?? undefined,
    defaultValue: f.defaultValue ?? undefined,
  }));
  return { obj, fields: lite };
}

async function enqueue(tx: Tx, workspaceId: string, type: string, payload: Record<string, unknown>) {
  await tx.insert(outbox).values({ workspaceId, type, payload });
}

async function replaceLinks(tx: Tx, workspaceId: string, recordId: string, fieldApiName: string, toIds: string[]) {
  await tx
    .delete(recordLinks)
    .where(and(eq(recordLinks.workspaceId, workspaceId), eq(recordLinks.fromRecordId, recordId), eq(recordLinks.fieldApiName, fieldApiName)));
  for (const toId of toIds) {
    await tx.insert(recordLinks).values({ workspaceId, fromRecordId: recordId, fieldApiName, toRecordId: toId }).onConflictDoNothing();
  }
}

export type WriteResult =
  | { ok: true; recordId: string; version: number }
  | { ok: false; errors: FieldError[] }
  | { ok: false; conflict: true; fields: string[] };

export interface CreateRecordInput {
  workspaceId: string;
  actorUserId: string;
  objectId: string;
  input: Record<string, unknown>;
  ownerId?: string | null;
  teamId?: string | null;
  isSample?: boolean;
  source?: string;
}

export async function createRecord(db: AnyPgDb, cmd: CreateRecordInput): Promise<WriteResult> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.create");
    const loaded = await loadObjectInTx(tx, cmd.objectId);
    if (!loaded) throw new Error("Object not found");

    const pr = await runPreProcessing(tx, {
      object: { id: cmd.objectId, titleFieldApiName: loaded.obj.titleFieldApiName },
      fields: loaded.fields,
      input: cmd.input,
      workspaceId: cmd.workspaceId,
      mode: "create",
    });
    if (!pr.ok) return { ok: false, errors: pr.errors };

    // Optional record numbering (PRP-00001 style).
    let recordNumber: string | null = null;
    if (loaded.obj.numberingPrefix) {
      const [bumped] = await tx
        .update(objectDefs)
        .set({ numberingSeq: (loaded.obj.numberingSeq ?? 0) + 1 })
        .where(eq(objectDefs.id, cmd.objectId))
        .returning({ seq: objectDefs.numberingSeq });
      recordNumber = `${loaded.obj.numberingPrefix}-${String(bumped.seq).padStart(5, "0")}`;
    }

    const [rec] = await tx
      .insert(records)
      .values({
        workspaceId: cmd.workspaceId,
        objectId: cmd.objectId,
        title: pr.title,
        recordNumber,
        ownerId: cmd.ownerId ?? cmd.actorUserId,
        teamId: cmd.teamId ?? null,
        isSample: cmd.isSample ?? false,
        data: pr.data,
        createdBy: cmd.actorUserId,
      })
      .returning({ id: records.id, version: records.version });

    for (const link of pr.links) {
      await replaceLinks(tx, cmd.workspaceId, rec.id, link.fieldApiName, link.toIds);
    }
    await tx.insert(recordHistory).values({
      workspaceId: cmd.workspaceId,
      recordId: rec.id,
      actorUserId: cmd.actorUserId,
      field: "(created)",
      before: null,
      after: pr.data,
      source: cmd.source ?? "ui",
    });
    await enqueue(tx, cmd.workspaceId, "record.created", { recordId: rec.id, objectId: cmd.objectId });

    return { ok: true, recordId: rec.id as string, version: rec.version as number };
  });
}

export interface UpdateRecordInput {
  workspaceId: string;
  actorUserId: string;
  recordId: string;
  input: Record<string, unknown>;
  expectedVersion?: number;
  source?: string;
}

export async function updateRecord(db: AnyPgDb, cmd: UpdateRecordInput): Promise<WriteResult> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.edit");
    const [existing] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, cmd.recordId), isNull(records.deletedAt)))
      .limit(1);
    if (!existing) throw new Error("Record not found");

    if (cmd.expectedVersion !== undefined && existing.version !== cmd.expectedVersion) {
      const changed = Object.keys(cmd.input).filter(
        (k) => JSON.stringify((existing.data as Record<string, unknown>)[k]) !== JSON.stringify(cmd.input[k]),
      );
      return { ok: false, conflict: true, fields: changed };
    }

    const loaded = await loadObjectInTx(tx, existing.objectId);
    if (!loaded) throw new Error("Object not found");

    const pr = await runPreProcessing(tx, {
      object: { id: existing.objectId, titleFieldApiName: loaded.obj.titleFieldApiName },
      fields: loaded.fields,
      input: cmd.input,
      workspaceId: cmd.workspaceId,
      mode: "update",
      recordId: cmd.recordId,
    });
    if (!pr.ok) return { ok: false, errors: pr.errors };

    // Field-level diffs (spec: who/when/old/new).
    const before = (existing.data as Record<string, unknown>) ?? {};
    const diffs: { field: string; before: unknown; after: unknown }[] = [];
    for (const [k, v] of Object.entries(pr.data)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(v)) diffs.push({ field: k, before: before[k] ?? null, after: v });
    }
    const merged = { ...before, ...pr.data };
    const newTitle = loaded.obj.titleFieldApiName ? String(merged[loaded.obj.titleFieldApiName] ?? existing.title ?? "") : existing.title;

    const [updated] = await tx
      .update(records)
      .set({ data: merged, title: newTitle, version: existing.version + 1, updatedAt: new Date() })
      .where(and(eq(records.id, cmd.recordId), eq(records.version, existing.version)))
      .returning({ version: records.version });
    if (!updated) return { ok: false, conflict: true, fields: Object.keys(cmd.input) };

    for (const link of pr.links) {
      await replaceLinks(tx, cmd.workspaceId, cmd.recordId, link.fieldApiName, link.toIds);
    }
    for (const d of diffs) {
      await tx.insert(recordHistory).values({
        workspaceId: cmd.workspaceId,
        recordId: cmd.recordId,
        actorUserId: cmd.actorUserId,
        field: d.field,
        before: d.before,
        after: d.after,
        source: cmd.source ?? "ui",
      });
    }
    await enqueue(tx, cmd.workspaceId, "record.updated", { recordId: cmd.recordId, changed: diffs.map((d) => d.field) });

    return { ok: true, recordId: cmd.recordId, version: updated.version as number };
  });
}

export async function softDeleteRecord(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; recordId: string },
): Promise<void> {
  await withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.delete");
    await tx.update(records).set({ deletedAt: new Date() }).where(eq(records.id, cmd.recordId));
    await tx.insert(recordHistory).values({
      workspaceId: cmd.workspaceId, recordId: cmd.recordId, actorUserId: cmd.actorUserId,
      field: "(deleted)", before: null, after: null, source: "ui",
    });
    await enqueue(tx, cmd.workspaceId, "record.deleted", { recordId: cmd.recordId });
  });
}

export async function restoreRecord(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; recordId: string },
): Promise<void> {
  await withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.delete");
    await tx.update(records).set({ deletedAt: null }).where(eq(records.id, cmd.recordId));
    await tx.insert(recordHistory).values({
      workspaceId: cmd.workspaceId, recordId: cmd.recordId, actorUserId: cmd.actorUserId,
      field: "(restored)", before: null, after: null, source: "ui",
    });
  });
}

export async function getRecord(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; recordId: string },
) {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const [rec] = await tx.select().from(records).where(eq(records.id, cmd.recordId)).limit(1);
    return rec ?? null;
  });
}

export async function getRecordHistory(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; recordId: string },
) {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) =>
    tx
      .select()
      .from(recordHistory)
      .where(eq(recordHistory.recordId, cmd.recordId))
      .orderBy(desc(recordHistory.at)),
  );
}

/** List records for an object, honouring the member's record scope. */
export async function listRecords(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; objectId: string; includeDeleted?: boolean },
) {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const [me] = await tx
      .select({ role: memberships.role, scopeType: memberships.scopeType })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, cmd.workspaceId), eq(memberships.userId, cmd.actorUserId)))
      .limit(1);
    if (!me) throw new Error("Actor is not a member of this workspace");

    const where = [eq(records.workspaceId, cmd.workspaceId), eq(records.objectId, cmd.objectId)];
    where.push(cmd.includeDeleted ? isNotNull(records.deletedAt) : isNull(records.deletedAt));
    // Record scope (spec record_scope): 'assigned' sees only own records.
    // 'team' and 'filter' are Phase 2.x follow-ups; 'all' adds no extra filter.
    if ((me.scopeType as string) === "assigned") where.push(eq(records.ownerId, cmd.actorUserId));

    return tx.select().from(records).where(and(...where)).orderBy(desc(records.updatedAt));
  });
}

export type { Role };
