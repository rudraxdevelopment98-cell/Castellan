import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { buildTodayPlan, type ObligationView } from "@/server/today";
import { getToday } from "@/lib/domain/clock";
import { formatUkDate, diffDays } from "@/lib/rules/dates";
import { regenerateObligationsAction } from "../../../actions";

function relative(due: string | null, today: string): string {
  if (!due) return "watch";
  const d = diffDays(due, today);
  if (d < 0) return `overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `in ${d} days`;
}

function brief(plan: Awaited<ReturnType<typeof buildTodayPlan>>): string[] {
  const lines: string[] = [];
  for (const o of plan.overdue.slice(0, 3)) lines.push(`Overdue: ${o.title} at ${o.recordLabel} (due ${o.dueDate}).`);
  const byCat = new Map<string, number>();
  for (const o of [...plan.dueToday, ...plan.startSoon]) byCat.set(o.category, (byCat.get(o.category) ?? 0) + 1);
  for (const [cat, n] of byCat) lines.push(`${n} ${cat} item${n === 1 ? "" : "s"} to handle.`);
  return lines;
}

export default async function TodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}/today`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const today = getToday();
  const plan = await buildTodayPlan(db, { workspaceId: membership.workspaceId, actorUserId: user.id, today });
  const lines = brief(plan);

  const Section = ({ title, items, tone }: { title: string; items: ObligationView[]; tone?: "overdue" }) =>
    items.length === 0 ? null : (
      <section className="overflow-hidden rounded-panel border border-rule bg-surface">
        <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
          <h2 className="text-section font-semibold text-ink">{title}</h2>
          <span className="tnum text-meta text-ink-muted">{items.length}</span>
        </div>
        <ul>
          {items.slice(0, 50).map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{o.title}</span>
                <span className="text-ink-muted"> · </span>
                <Link href={`/w/${slug}/o/${o.objectApiName}/${o.recordId}`} className="text-ink hover:text-brand">{o.recordLabel}</Link>
                {o.why && <span className="block text-meta text-ink-muted">{o.why}</span>}
              </span>
              <span className={`tnum text-meta ${tone === "overdue" ? "text-overdue" : "text-ink-muted"}`}>
                {o.dueDate ? `${formatUkDate(o.dueDate)} · ${relative(o.dueDate, today)}` : "watch"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">Today</h1>
          <p className="text-meta text-ink-muted">{formatUkDate(today)} · {membership.name}</p>
        </div>
        <form action={regenerateObligationsAction}>
          <input type="hidden" name="slug" value={slug} />
          <button className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas">Update list</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-panel border border-rule bg-surface px-4 py-3"><div className="tnum text-title font-semibold text-ink">{plan.counts.total}</div><div className="text-meta text-ink-muted">To handle today</div></div>
        <div className="rounded-panel border border-rule bg-surface px-4 py-3"><div className={`tnum text-title font-semibold ${plan.counts.overdue ? "text-overdue" : "text-ink"}`}>{plan.counts.overdue}</div><div className="text-meta text-ink-muted">Overdue</div></div>
      </div>

      <section className="overflow-hidden rounded-panel border border-rule bg-surface">
        <div className="border-b border-rule px-4 py-2.5"><h2 className="text-section font-semibold text-ink">Morning brief</h2></div>
        <div className="px-4 py-3 text-body">
          <p className="font-medium text-ink">Good morning. {plan.counts.total === 0 ? "Nothing needs your attention today." : `${plan.counts.total} thing${plan.counts.total === 1 ? "" : "s"} today, ${plan.counts.overdue} overdue.`}</p>
          <ul className="mt-2 space-y-1 text-ink-muted">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="mt-3 text-meta text-ink-muted">One digest — sent 07:30 to email, WhatsApp and push in production.</p>
        </div>
      </section>

      <Section title="Overdue" items={plan.overdue} tone="overdue" />
      <Section title="Due today" items={plan.dueToday} />
      <Section title="Good to start today" items={plan.startSoon} />

      {plan.counts.total === 0 && (
        <div className="rounded-panel border border-rule bg-surface px-4 py-10 text-center text-ink-muted">
          Nothing needs attention today. If you just added records, choose “Update list”.
        </div>
      )}
    </div>
  );
}
