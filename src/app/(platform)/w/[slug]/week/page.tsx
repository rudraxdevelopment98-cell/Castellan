import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { buildWeekPlan } from "@/server/today";
import { getToday } from "@/lib/domain/clock";

export default async function WeekPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}/week`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const week = await buildWeekPlan(db, { workspaceId: membership.workspaceId, actorUserId: user.id, today: getToday() });

  return (
    <div className="space-y-4">
      <h1 className="text-title font-semibold text-ink">This week</h1>
      <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
        {week.map((col, idx) => (
          <div key={col.date} className="rounded-panel border border-rule bg-surface">
            <div className="border-b border-rule px-3 py-2">
              <div className="text-table font-medium text-ink">{col.label}</div>
              <div className="tnum text-meta text-ink-muted">{col.items.length} items{idx === 0 ? " (incl. overdue)" : ""}</div>
            </div>
            <ul className="max-h-[420px] space-y-1 overflow-y-auto p-2">
              {col.items.length === 0 ? (
                <li className="px-1 py-2 text-meta text-ink-muted">—</li>
              ) : (
                col.items.slice(0, 40).map((o) => (
                  <li key={o.id}>
                    <Link href={`/w/${slug}/o/${o.objectApiName}/${o.recordId}`} className="block rounded-ctl border border-rule px-2 py-1.5 hover:bg-canvas">
                      <span className="block truncate text-meta font-medium text-ink">{o.title}</span>
                      <span className="block truncate text-[12px] text-ink-muted">{o.recordLabel}</span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
