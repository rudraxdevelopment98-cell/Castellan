import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getObjectById, listObjects } from "@/server/metadata";
import { can } from "@/server/rbac";
import { createObjectAction, addFieldAction } from "../../../actions";

const FIELD_TYPES = [
  "text", "long_text", "number", "currency", "percent", "date", "datetime",
  "boolean", "single_select", "multi_select", "status", "email", "phone", "url",
  "address", "person", "relation", "file", "sensitive_text",
];

export default async function DataModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const user = await requireUser(`/w/${slug}/data`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const canManage = can(membership.role, "structure.manage");
  const db = await getDb();
  const objects = await listObjects(db, { workspaceId: membership.workspaceId, actorUserId: user.id });
  const detailed = await Promise.all(
    objects.map((o: { id: string }) => getObjectById(db, { workspaceId: membership.workspaceId, actorUserId: user.id, objectId: o.id })),
  );

  return (
    <div className="space-y-5">
      <h1 className="text-title font-semibold text-ink">Data model</h1>
      <p className="text-meta text-ink-muted">Objects and fields in this workspace. api_name is immutable once created.</p>
      {error && <p className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</p>}

      {detailed.filter(Boolean).map((obj) => (
        <section key={obj!.id} className="overflow-hidden rounded-panel border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <h2 className="text-section font-semibold text-ink">{obj!.pluralLabel} <span className="text-meta font-normal text-ink-muted">({obj!.apiName})</span></h2>
            <Link href={`/w/${slug}/o/${obj!.apiName}`} className="text-meta font-medium text-brand hover:underline">Open grid →</Link>
          </div>
          <table className="w-full border-collapse text-table">
            <thead>
              <tr className="border-b border-rule text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">api_name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {obj!.fields.map((f: { apiName: string; label: string; type: string; required?: boolean; unique?: boolean }) => (
                <tr key={f.apiName} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-1.5 text-ink">{f.label}</td>
                  <td className="tnum px-3 py-1.5 text-ink-muted">{f.apiName}</td>
                  <td className="px-3 py-1.5 text-ink-muted">{f.type}</td>
                  <td className="px-3 py-1.5 text-meta text-ink-muted">{[f.required ? "required" : "", f.unique ? "unique" : ""].filter(Boolean).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && (
            <form action={addFieldAction} className="flex flex-wrap items-end gap-2 border-t border-rule px-4 py-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="objectId" value={obj!.id} />
              <label className="block"><span className="text-meta text-ink-muted">Label</span><input name="label" required className="mt-1 w-36 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
              <label className="block"><span className="text-meta text-ink-muted">api_name</span><input name="apiName" required pattern="[a-z][a-z0-9_]*" className="mt-1 w-32 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
              <label className="block"><span className="text-meta text-ink-muted">Type</span>
                <select name="type" className="mt-1 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table">
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block"><span className="text-meta text-ink-muted">Options (select, comma-sep)</span><input name="options" className="mt-1 w-40 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
              <label className="flex items-center gap-1 text-meta text-ink-muted"><input type="checkbox" name="required" /> required</label>
              <label className="flex items-center gap-1 text-meta text-ink-muted"><input type="checkbox" name="unique" /> unique</label>
              <button className="rounded-ctl bg-brand px-3 py-1.5 text-table font-medium text-white hover:opacity-90">Add field</button>
            </form>
          )}
        </section>
      ))}

      {canManage && (
        <section className="rounded-panel border border-rule bg-surface p-4">
          <h2 className="text-section font-semibold text-ink">New object</h2>
          <form action={createObjectAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <label className="block"><span className="text-meta text-ink-muted">Singular</span><input name="singular" required placeholder="Vehicle" className="mt-1 w-36 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
            <label className="block"><span className="text-meta text-ink-muted">Plural</span><input name="plural" placeholder="Vehicles" className="mt-1 w-36 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
            <label className="block"><span className="text-meta text-ink-muted">api_name</span><input name="apiName" required pattern="[a-z][a-z0-9_]*" placeholder="vehicle" className="mt-1 w-32 rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table" /></label>
            <button className="rounded-ctl bg-brand px-3 py-1.5 text-table font-medium text-white hover:opacity-90">Create object</button>
          </form>
          <p className="mt-2 text-meta text-ink-muted">A title field <code>name</code> is added automatically.</p>
        </section>
      )}
    </div>
  );
}
