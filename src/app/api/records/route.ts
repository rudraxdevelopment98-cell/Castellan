import { currentUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getObjectByApiName } from "@/server/metadata";
import { createRecord, softDeleteRecord, updateRecord } from "@/server/records";
import { getDb } from "@/server/db/client";
import { PermissionError } from "@/server/rbac";

export const runtime = "nodejs";

async function auth(slug: string) {
  const user = await currentUser();
  if (!user) return { error: "Not signed in", status: 401 as const };
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) return { error: "No access to this workspace", status: 403 as const };
  return { user, membership };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.slug || !body?.objectApiName) return Response.json({ error: "Bad request" }, { status: 400 });
  const a = await auth(body.slug);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: a.membership.workspaceId, actorUserId: a.user.id, apiName: body.objectApiName });
  if (!obj) return Response.json({ error: "Object not found" }, { status: 404 });
  try {
    const res = await createRecord(db, {
      workspaceId: a.membership.workspaceId, actorUserId: a.user.id, objectId: obj.id, input: body.input ?? {},
    });
    return Response.json(res, { status: res.ok ? 200 : 422 });
  } catch (e) {
    if (e instanceof PermissionError) return Response.json({ error: "Not permitted" }, { status: 403 });
    throw e;
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.slug || !body?.recordId) return Response.json({ error: "Bad request" }, { status: 400 });
  const a = await auth(body.slug);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  const db = await getDb();
  try {
    const res = await updateRecord(db, {
      workspaceId: a.membership.workspaceId, actorUserId: a.user.id, recordId: body.recordId,
      input: body.input ?? {}, expectedVersion: body.expectedVersion,
    });
    return Response.json(res, { status: res.ok ? 200 : 422 });
  } catch (e) {
    if (e instanceof PermissionError) return Response.json({ error: "Not permitted" }, { status: 403 });
    throw e;
  }
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.slug || !body?.recordId) return Response.json({ error: "Bad request" }, { status: 400 });
  const a = await auth(body.slug);
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  const db = await getDb();
  try {
    await softDeleteRecord(db, { workspaceId: a.membership.workspaceId, actorUserId: a.user.id, recordId: body.recordId });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof PermissionError) return Response.json({ error: "Not permitted" }, { status: 403 });
    throw e;
  }
}
