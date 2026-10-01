import { currentUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import {
  createDocument,
  softDeleteDocument,
  updateDocumentMeta,
  MAX_DOC_BYTES,
} from "@/server/documents";

export const runtime = "nodejs";
export const maxDuration = 30;

async function auth(slug: string | null) {
  if (!slug) return { error: "Bad request", status: 400 as const };
  const user = await currentUser();
  if (!user) return { error: "Not signed in", status: 401 as const };
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) return { error: "No access to this workspace", status: 403 as const };
  return { user, membership };
}

function parseReminderDays(raw: string | null): number[] | undefined {
  if (!raw) return undefined;
  const nums = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return nums.length ? nums : undefined;
}

/** Upload a document (multipart/form-data). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected multipart form data" }, { status: 400 });

  const slug = (form.get("slug") as string) || null;
  const a = await auth(slug);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "A file is required." }, { status: 400 });
  }
  if (file.size > MAX_DOC_BYTES) {
    return Response.json({ error: `File is too large (max ${Math.floor(MAX_DOC_BYTES / 1024 / 1024)} MB).` }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const db = await getDb();
  const res = await createDocument(db, {
    workspaceId: a.membership.workspaceId,
    actorUserId: a.user.id,
    filename: file.name || "upload",
    mime: file.type || "application/octet-stream",
    bytes,
    title: (form.get("title") as string) || null,
    recordId: (form.get("recordId") as string) || null,
    objectApiName: (form.get("objectApiName") as string) || null,
    docType: (form.get("docType") as string) || null,
    keyDate: (form.get("keyDate") as string) || null,
    reminderDays: parseReminderDays(form.get("reminderDays") as string | null),
    note: (form.get("note") as string) || null,
  });
  return Response.json(res, { status: res.ok ? 200 : 422 });
}

/** Edit a document's metadata (key date, type, note). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const a = await auth(body?.slug ?? null);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  if (!body?.id) return Response.json({ error: "Bad request" }, { status: 400 });
  const db = await getDb();
  const res = await updateDocumentMeta(db, {
    workspaceId: a.membership.workspaceId,
    actorUserId: a.user.id,
    id: body.id,
    title: body.title,
    docType: body.docType,
    keyDate: body.keyDate,
    reminderDays: body.reminderDays,
    note: body.note,
  });
  return Response.json(res);
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const a = await auth(body?.slug ?? null);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  if (!body?.id) return Response.json({ error: "Bad request" }, { status: 400 });
  const db = await getDb();
  const res = await softDeleteDocument(db, {
    workspaceId: a.membership.workspaceId,
    actorUserId: a.user.id,
    id: body.id,
  });
  return Response.json(res);
}
