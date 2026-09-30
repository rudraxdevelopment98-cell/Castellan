import { currentUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getObjectByApiName } from "@/server/metadata";
import { getDb } from "@/server/db/client";
import { parseCsv } from "@/server/csv";
import { analyzeImport, commitImport, undoImport } from "@/server/import";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Auto-map CSV headers to field api_names / labels (case-insensitive). */
function autoMap(headers: string[], fields: { apiName: string; label: string }[]): Record<string, number> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const mapping: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i] ?? "");
    const f = fields.find((x) => norm(x.apiName) === h || norm(x.label) === h);
    if (f) mapping[f.apiName] = i;
  }
  return mapping;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode as "analyze" | "commit" | "undo" | undefined;
  if (!body?.slug || !mode) return Response.json({ error: "Bad request" }, { status: 400 });

  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const membership = await resolveWorkspaceForUser(user.id, body.slug);
  if (!membership) return Response.json({ error: "No access" }, { status: 403 });
  const db = await getDb();

  if (mode === "undo") {
    const res = await undoImport(db, { workspaceId: membership.workspaceId, actorUserId: user.id, importId: body.importId });
    return Response.json(res);
  }

  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: body.objectApiName });
  if (!obj) return Response.json({ error: "Object not found" }, { status: 404 });

  const parsed = parseCsv(String(body.csv ?? ""));
  if (parsed.length < 2) return Response.json({ error: "Need a header row and at least one data row." }, { status: 400 });
  const headers = parsed[0]!;
  const rows = parsed.slice(1);
  const mapping = body.mapping ?? autoMap(headers, obj.fields);
  if (Object.keys(mapping).length === 0) {
    return Response.json({ error: "No columns matched your fields. Rename headers to match field names." }, { status: 400 });
  }

  if (mode === "analyze") {
    const analysis = await analyzeImport(db, { workspaceId: membership.workspaceId, actorUserId: user.id, objectId: obj.id, mapping, rows });
    return Response.json({ analysis, mapping, headers, mappedFields: Object.keys(mapping) });
  }
  // commit
  const res = await commitImport(db, { workspaceId: membership.workspaceId, actorUserId: user.id, objectId: obj.id, mapping, rows });
  return Response.json(res);
}
