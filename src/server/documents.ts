import { and, desc, eq, isNull } from "drizzle-orm";
import { documents } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";

/**
 * Documents domain: store uploaded files in the database (bytea), list and fetch
 * them, and track an optional key date (expiry / renewal) with a reminder ladder.
 * Everything runs through withWorkspace, so RLS scopes every row to the tenant.
 *
 * Byte payloads are never selected in list queries — only when a single file is
 * downloaded — so listing stays cheap.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export const MAX_DOC_BYTES = 15 * 1024 * 1024; // 15 MB per file

export interface DocumentMeta {
  id: string;
  recordId: string | null;
  objectApiName: string | null;
  title: string | null;
  filename: string;
  mime: string;
  size: number;
  docType: string | null;
  keyDate: string | null;
  reminderDays: number[];
  note: string | null;
  createdAt: string;
}

const META_COLS = {
  id: documents.id,
  recordId: documents.recordId,
  objectApiName: documents.objectApiName,
  title: documents.title,
  filename: documents.filename,
  mime: documents.mime,
  size: documents.size,
  docType: documents.docType,
  keyDate: documents.keyDate,
  reminderDays: documents.reminderDays,
  note: documents.note,
  createdAt: documents.createdAt,
};

function toMeta(r: Record<string, unknown>): DocumentMeta {
  return {
    id: String(r.id),
    recordId: (r.recordId as string | null) ?? null,
    objectApiName: (r.objectApiName as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    filename: String(r.filename),
    mime: String(r.mime),
    size: Number(r.size),
    docType: (r.docType as string | null) ?? null,
    keyDate: (r.keyDate as string | null) ?? null,
    reminderDays: (r.reminderDays as number[] | null) ?? [],
    note: (r.note as string | null) ?? null,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export interface CreateDocumentInput {
  workspaceId: string;
  actorUserId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
  title?: string | null;
  recordId?: string | null;
  objectApiName?: string | null;
  docType?: string | null;
  keyDate?: string | null;
  reminderDays?: number[];
  note?: string | null;
}

export async function createDocument(
  db: AnyPgDb,
  input: CreateDocumentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.filename) return { ok: false, error: "A file is required." };
  if (input.bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (input.bytes.length > MAX_DOC_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.floor(MAX_DOC_BYTES / 1024 / 1024)} MB).` };
  }
  const keyDate = normalizeDate(input.keyDate);
  if (input.keyDate && !keyDate) return { ok: false, error: "Key date must be a valid date." };

  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx: Tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        workspaceId: input.workspaceId,
        recordId: input.recordId ?? null,
        objectApiName: input.objectApiName ?? null,
        title: input.title?.trim() || input.filename,
        filename: input.filename,
        mime: input.mime || "application/octet-stream",
        size: input.bytes.length,
        bytes: input.bytes,
        docType: input.docType?.trim() || null,
        keyDate: keyDate,
        reminderDays: sanitizeReminderDays(input.reminderDays),
        note: input.note?.trim() || null,
        uploadedBy: input.actorUserId,
      })
      .returning({ id: documents.id });
    return { ok: true as const, id: String(row.id) };
  });
}

export async function listDocuments(
  db: AnyPgDb,
  args: { workspaceId: string; actorUserId: string; recordId?: string },
): Promise<DocumentMeta[]> {
  return withWorkspace(db, { workspaceId: args.workspaceId, userId: args.actorUserId }, async (tx: Tx) => {
    const where = args.recordId
      ? and(eq(documents.workspaceId, args.workspaceId), isNull(documents.deletedAt), eq(documents.recordId, args.recordId))
      : and(eq(documents.workspaceId, args.workspaceId), isNull(documents.deletedAt));
    const rows = await tx.select(META_COLS).from(documents).where(where).orderBy(desc(documents.createdAt));
    return rows.map(toMeta);
  });
}

/** Documents that carry a key date, soonest first (the personal/home reminder list). */
export async function listDocumentsWithDates(
  db: AnyPgDb,
  args: { workspaceId: string; actorUserId: string },
): Promise<DocumentMeta[]> {
  const all = await listDocuments(db, args);
  return all
    .filter((d) => d.keyDate)
    .sort((a, b) => (a.keyDate! < b.keyDate! ? -1 : a.keyDate! > b.keyDate! ? 1 : 0));
}

export async function getDocumentBytes(
  db: AnyPgDb,
  args: { workspaceId: string; actorUserId: string; id: string },
): Promise<{ filename: string; mime: string; bytes: Buffer } | null> {
  return withWorkspace(db, { workspaceId: args.workspaceId, userId: args.actorUserId }, async (tx: Tx) => {
    const [row] = await tx
      .select({ filename: documents.filename, mime: documents.mime, bytes: documents.bytes, deletedAt: documents.deletedAt })
      .from(documents)
      .where(and(eq(documents.workspaceId, args.workspaceId), eq(documents.id, args.id)))
      .limit(1);
    if (!row || row.deletedAt) return null;
    const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes as Uint8Array);
    return { filename: String(row.filename), mime: String(row.mime), bytes };
  });
}

export async function updateDocumentMeta(
  db: AnyPgDb,
  args: {
    workspaceId: string;
    actorUserId: string;
    id: string;
    title?: string | null;
    docType?: string | null;
    keyDate?: string | null;
    reminderDays?: number[];
    note?: string | null;
  },
): Promise<{ ok: boolean }> {
  const keyDate = normalizeDate(args.keyDate);
  return withWorkspace(db, { workspaceId: args.workspaceId, userId: args.actorUserId }, async (tx: Tx) => {
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title?.trim() || null;
    if (args.docType !== undefined) patch.docType = args.docType?.trim() || null;
    if (args.keyDate !== undefined) patch.keyDate = keyDate;
    if (args.reminderDays !== undefined) patch.reminderDays = sanitizeReminderDays(args.reminderDays);
    if (args.note !== undefined) patch.note = args.note?.trim() || null;
    if (Object.keys(patch).length === 0) return { ok: true };
    await tx
      .update(documents)
      .set(patch)
      .where(and(eq(documents.workspaceId, args.workspaceId), eq(documents.id, args.id)));
    return { ok: true };
  });
}

export async function softDeleteDocument(
  db: AnyPgDb,
  args: { workspaceId: string; actorUserId: string; id: string },
): Promise<{ ok: boolean }> {
  return withWorkspace(db, { workspaceId: args.workspaceId, userId: args.actorUserId }, async (tx: Tx) => {
    await tx
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(documents.workspaceId, args.workspaceId), eq(documents.id, args.id)));
    return { ok: true };
  });
}

function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function sanitizeReminderDays(days: number[] | undefined): number[] {
  if (!days || days.length === 0) return [30, 7, 1];
  const clean = Array.from(
    new Set(days.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n >= 0 && n <= 3650)),
  ).sort((a, b) => b - a);
  return clean.length ? clean : [30, 7, 1];
}
