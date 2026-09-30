import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getObjectByApiName } from "@/server/metadata";
import { queryRecords } from "@/server/records_query";
import { formatFieldValue } from "@/lib/fieldDisplay";

const COLS = 6; // visible columns kept readable; column manager is a follow-up

export default async function ObjectGrid({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; objectApiName: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, objectApiName } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/w/${slug}/o/${objectApiName}`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: objectApiName });
  if (!obj) notFound();

  const search = typeof sp.q === "string" ? sp.q : "";
  const curRaw = typeof sp.cur === "string" ? sp.cur : "";
  const cursor = curRaw.includes("|") ? { updatedAt: curRaw.split("|")[0]!, id: curRaw.split("|").slice(1).join("|") } : null;

  const page = await queryRecords(db, {
    workspaceId: membership.workspaceId, actorUserId: user.id, objectId: obj.id,
    search: search || undefined, cursor, limit: 50,
  });

  const columns = obj.fields.filter((f) => f.type !== "sensitive_text").slice(0, COLS);
  const base = `/w/${slug}/o/${objectApiName}`;
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">{obj.pluralLabel}</h1>
          <p className="tnum text-meta text-ink-muted">{page.total} record{page.total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`${base}/new`} className="rounded-ctl bg-brand px-3 py-1.5 text-table font-medium text-white hover:opacity-90">New</Link>
          <Link href={`${base}/import`} className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas">Import</Link>
          <a href={`/api/export?slug=${slug}&object=${objectApiName}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas">Export</a>
        </div>
      </div>

      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={search} placeholder="Search…" className="w-72 rounded-ctl border border-rule bg-surface px-3 py-2 text-table text-ink" />
        <button className="rounded-ctl border border-rule px-3 py-2 text-table text-ink hover:bg-canvas">Search</button>
        {search && <Link href={base} className="rounded-ctl px-3 py-2 text-table text-ink-muted hover:bg-canvas">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-panel border border-rule bg-surface">
        {page.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-ink-muted">
            {search ? "No records match your search." : `No ${obj.pluralLabel.toLowerCase()} yet.`}{" "}
            {!search && <Link href={`${base}/new`} className="font-medium text-brand hover:underline">Add the first one</Link>}
          </div>
        ) : (
          <table className="w-full border-collapse text-table">
            <thead>
              <tr className="border-b border-rule text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">{obj.singularLabel}</th>
                {columns.map((c) => <th key={c.apiName} className="px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => (
                <tr key={r.id} className="border-b border-rule hover:bg-canvas last:border-b-0">
                  <td className="px-4 py-1.5">
                    <Link href={`${base}/${r.id}`} className="font-medium text-ink hover:text-brand">
                      {r.title || r.recordNumber || "(untitled)"}
                    </Link>
                    {r.isSample && <span className="ml-2 rounded-ctl border border-rule px-1.5 py-0.5 text-[11px] text-ink-muted">Sample</span>}
                  </td>
                  {columns.map((c) => (
                    <td key={c.apiName} className="tnum px-3 py-1.5 text-ink-muted">{formatFieldValue(r.data[c.apiName], c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {page.nextCursor && (
        <div className="text-center">
          <Link href={`${base}${qs({ cur: `${page.nextCursor.updatedAt}|${page.nextCursor.id}` })}`} className="inline-block rounded-ctl border border-rule px-4 py-2 text-table text-ink hover:bg-canvas">
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
