import { currentUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getObjectByApiName } from "@/server/metadata";
import { getDb } from "@/server/db/client";
import { exportCsv } from "@/server/export";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const objectApiName = url.searchParams.get("object");
  const search = url.searchParams.get("q") ?? undefined;
  if (!slug || !objectApiName) return new Response("Bad request", { status: 400 });

  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) return new Response("No access", { status: 403 });

  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: objectApiName });
  if (!obj) return new Response("Object not found", { status: 404 });

  const csv = await exportCsv(db, {
    workspaceId: membership.workspaceId, actorUserId: user.id, objectId: obj.id, fields: obj.fields, search,
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${objectApiName}.csv"`,
    },
  });
}
