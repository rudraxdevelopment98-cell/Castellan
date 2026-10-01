import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getObjectByApiName } from "@/server/metadata";
import { getRecord, getRecordHistory } from "@/server/records";
import { listDocuments } from "@/server/documents";
import { RecordForm } from "@/components/RecordForm";
import { DocumentsManager, type DocItem } from "@/components/DocumentsManager";
import { formatFieldValue } from "@/lib/fieldDisplay";
import { formatUkDate } from "@/lib/rules/dates";

export default async function RecordDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; objectApiName: string; recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, objectApiName, recordId } = await params;
  const sp = await searchParams;
  const editing = sp.edit === "1";
  const user = await requireUser(`/w/${slug}/o/${objectApiName}/${recordId}`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: objectApiName });
  if (!obj) notFound();
  const rec = await getRecord(db, { workspaceId: membership.workspaceId, actorUserId: user.id, recordId });
  if (!rec) notFound();
  const history = await getRecordHistory(db, { workspaceId: membership.workspaceId, actorUserId: user.id, recordId });
  const docs = (await listDocuments(db, { workspaceId: membership.workspaceId, actorUserId: user.id, recordId })) as DocItem[];
  const data = rec.data as Record<string, unknown>;
  const base = `/w/${slug}/o/${objectApiName}`;

  const fieldLabel = (api: string) => obj.fields.find((f) => f.apiName === api)?.label ?? api;
  const fieldFor = (api: string) => obj.fields.find((f) => f.apiName === api);

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href={base} className="text-meta text-ink-muted hover:underline">← {obj.pluralLabel}</Link>
          <h1 className="mt-1 text-title font-semibold text-ink">{rec.title || rec.recordNumber || "(untitled)"}</h1>
          {rec.recordNumber && <p className="tnum text-meta text-ink-muted">{rec.recordNumber}</p>}
        </div>
        {!editing && <Link href={`${base}/${recordId}?edit=1`} className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas">Edit</Link>}
      </div>

      {editing ? (
        <div className="max-w-lg rounded-panel border border-rule bg-surface p-4">
          <RecordForm slug={slug} objectApiName={objectApiName} fields={obj.fields} mode="edit" recordId={recordId} version={rec.version} initial={data} />
        </div>
      ) : (
        <section className="overflow-hidden rounded-panel border border-rule bg-surface">
          <dl className="divide-y divide-rule">
            {obj.fields.map((f) => (
              <div key={f.apiName} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-meta text-ink-muted">{f.label}</dt>
                <dd className="tnum max-w-[60%] text-right text-table text-ink">{formatFieldValue(data[f.apiName], f)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-section font-semibold text-ink">Documents</h2>
        <DocumentsManager
          slug={slug}
          documents={docs}
          recordId={recordId}
          objectApiName={objectApiName}
          compact
        />
      </section>

      <section className="overflow-hidden rounded-panel border border-rule bg-surface">
        <h2 className="border-b border-rule px-4 py-2 text-section font-semibold text-ink">History</h2>
        <ul className="divide-y divide-rule">
          {history.map((h: { id: string; field: string; before: unknown; after: unknown; at: Date | string }) => {
            const f = fieldFor(h.field);
            return (
              <li key={h.id} className="px-4 py-2 text-meta">
                <span className="text-ink">{h.field.startsWith("(") ? h.field : fieldLabel(h.field)}</span>{" "}
                {!h.field.startsWith("(") && (
                  <span className="text-ink-muted">
                    {f ? formatFieldValue(h.before, f) : String(h.before ?? "—")} → {f ? formatFieldValue(h.after, f) : String(h.after ?? "—")}
                  </span>
                )}
                <span className="tnum ml-2 text-ink-muted">{typeof h.at === "string" ? h.at.slice(0, 10) : formatUkDate(h.at.toISOString().slice(0, 10))}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
