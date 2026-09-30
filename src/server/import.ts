import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { fieldDefs, objectDefs, outbox, recordHistory, records } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { actorRoleInTx } from "./membership";
import { requireCap } from "./rbac";
import { appendAudit } from "./audit";
import { runPreProcessing } from "./pipeline";
import type { FieldDefLite, FieldError, FieldType } from "./pipeline/fieldtypes";

/**
 * Import wizard back end (spec import_export). Analyse produces a dry-run
 * (ready / errors) without writing; commit inserts valid rows in one transaction
 * tagged with an import_id; undo removes exactly that batch. The same
 * pre-processing pipeline as the UI validates each row, so behaviour is identical.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function loadFields(tx: Tx, objectId: string): Promise<{ obj: any; fields: FieldDefLite[] } | null> {
  const [obj] = await tx.select().from(objectDefs).where(eq(objectDefs.id, objectId)).limit(1);
  if (!obj) return null;
  const fs = await tx.select().from(fieldDefs).where(eq(fieldDefs.objectId, objectId));
  const fields: FieldDefLite[] = fs.map((f: any) => ({
    apiName: f.apiName, label: f.label, type: f.type as FieldType,
    required: f.required, unique: f.unique, config: f.config ?? undefined, defaultValue: f.defaultValue ?? undefined,
  }));
  return { obj, fields };
}

/** mapping: fieldApiName -> csv column index. */
function rowToInput(mapping: Record<string, number>, cells: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [apiName, colIdx] of Object.entries(mapping)) {
    const v = cells[colIdx];
    if (v !== undefined && v !== "") input[apiName] = v;
  }
  return input;
}

export interface ImportAnalysis {
  total: number;
  ready: number;
  errorRows: { rowIndex: number; errors: FieldError[] }[];
}

export async function analyzeImport(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; objectId: string; mapping: Record<string, number>; rows: string[][] },
): Promise<ImportAnalysis> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const loaded = await loadFields(tx, cmd.objectId);
    if (!loaded) throw new Error("Object not found");
    const errorRows: { rowIndex: number; errors: FieldError[] }[] = [];
    let ready = 0;
    for (let i = 0; i < cmd.rows.length; i++) {
      const pr = await runPreProcessing(tx, {
        object: { id: cmd.objectId, titleFieldApiName: loaded.obj.titleFieldApiName },
        fields: loaded.fields,
        input: rowToInput(cmd.mapping, cmd.rows[i]!),
        workspaceId: cmd.workspaceId,
        mode: "create",
      });
      if (pr.ok) ready++;
      else errorRows.push({ rowIndex: i, errors: pr.errors });
    }
    return { total: cmd.rows.length, ready, errorRows };
  });
}

export interface ImportResult {
  importId: string;
  created: number;
  skipped: number;
}

export async function commitImport(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; objectId: string; mapping: Record<string, number>; rows: string[][] },
): Promise<ImportResult> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.create");
    const loaded = await loadFields(tx, cmd.objectId);
    if (!loaded) throw new Error("Object not found");
    const importId = randomUUID();
    let created = 0;
    let skipped = 0;

    for (const cells of cmd.rows) {
      const pr = await runPreProcessing(tx, {
        object: { id: cmd.objectId, titleFieldApiName: loaded.obj.titleFieldApiName },
        fields: loaded.fields,
        input: rowToInput(cmd.mapping, cells),
        workspaceId: cmd.workspaceId,
        mode: "create",
      });
      if (!pr.ok) { skipped++; continue; }
      const [rec] = await tx
        .insert(records)
        .values({
          workspaceId: cmd.workspaceId, objectId: cmd.objectId, title: pr.title,
          ownerId: cmd.actorUserId, createdBy: cmd.actorUserId, importId, data: pr.data,
        })
        .returning({ id: records.id });
      await tx.insert(recordHistory).values({
        workspaceId: cmd.workspaceId, recordId: rec.id, actorUserId: cmd.actorUserId,
        field: "(imported)", before: null, after: pr.data, source: "import",
      });
      created++;
    }

    await tx.insert(outbox).values({ workspaceId: cmd.workspaceId, type: "import.committed", payload: { importId, created } });
    await appendAudit(tx, {
      workspaceId: cmd.workspaceId, actorUserId: cmd.actorUserId, action: "import.committed",
      entity: "import", entityId: importId, after: { created, skipped },
    });
    return { importId, created, skipped };
  });
}

/** Undo an import: remove exactly the records it created (cascades links/history). */
export async function undoImport(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string; importId: string },
): Promise<{ removed: number }> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, cmd.workspaceId, cmd.actorUserId), "records.delete");
    const removed = await tx
      .delete(records)
      .where(and(eq(records.workspaceId, cmd.workspaceId), eq(records.importId, cmd.importId)))
      .returning({ id: records.id });
    await appendAudit(tx, {
      workspaceId: cmd.workspaceId, actorUserId: cmd.actorUserId, action: "import.undone",
      entity: "import", entityId: cmd.importId, after: { removed: removed.length },
    });
    return { removed: removed.length };
  });
}
