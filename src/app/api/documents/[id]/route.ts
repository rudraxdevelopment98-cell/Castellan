import { currentUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getDocumentBytes } from "@/server/documents";
import { downloadHeaders } from "@/server/uploads";

export const runtime = "nodejs";

/**
 * Download a stored document. The workspace is taken from ?slug= and checked
 * against the signed-in user; RLS scopes the fetch to that tenant.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return new Response("Bad request", { status: 400 });

  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const membership = await resolveWorkspaceForUser(user.id, slug);
  // A workspace the caller cannot see answers exactly like a missing document.
  if (!membership) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const doc = await getDocumentBytes(db, { workspaceId: membership.workspaceId, actorUserId: user.id, id });
  if (!doc) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(doc.bytes), {
    status: 200,
    headers: downloadHeaders(doc.mime, doc.filename, doc.bytes.length),
  });
}
