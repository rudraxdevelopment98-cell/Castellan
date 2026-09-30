import { Content, PageHeader, Panel } from "@/components/primitives";
import { BandBadge } from "@/components/status";
import { buildLookahead, buildWeekPlan } from "@/lib/domain/views";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

export default async function WeekPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, today, templateId } = await resolveContext(searchParams);
  const week = buildWeekPlan(data, today);
  const lookahead = buildLookahead(data, today).slice(0, 8);

  return (
    <>
      <PageHeader title="This week" meta="Plan the next seven days. Rescheduling moves the planned date, never the legal due date." />
      <Content>
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
                  col.items.slice(0, 30).map((ob) => (
                    <li key={ob.id}>
                      <a
                        href={withTemplate(`/records/${ob.recordId}`, templateId)}
                        className="block rounded-ctl border border-rule px-2 py-1.5 hover:bg-canvas"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-meta font-medium text-ink">{ob.title}</span>
                          <BandBadge band={ob.band} />
                        </div>
                        <span className="tnum block truncate text-[12px] text-ink-muted">{ob.recordLabel}</span>
                      </a>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>

        <Panel title="Next 90 days — clusters to plan for">
          <div className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
            {lookahead.length === 0 ? (
              <div className="col-span-full bg-surface px-4 py-6 text-center text-ink-muted">
                Nothing clustered in the next 90 days.
              </div>
            ) : (
              lookahead.map((c) => (
                <div key={`${c.month}-${c.category}`} className="bg-surface px-4 py-3">
                  <div className="tnum text-section font-semibold text-ink">{c.count}</div>
                  <div className="text-meta text-ink-muted">
                    {c.category} · {c.month}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </Content>
    </>
  );
}
