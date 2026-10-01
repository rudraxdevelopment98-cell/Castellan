import { Content, PageHeader, Panel, Stat } from "@/components/primitives";
import { BandBadge } from "@/components/status";
import { formatUkDate } from "@/lib/rules/dates";
import { buildTodayPlan, type ObligationView } from "@/lib/domain/views";
import { composeMorningBrief } from "@/lib/domain/notify";
import { formatMoney, relativeDue } from "@/lib/domain/format";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, today, templateId } = await resolveContext(searchParams);
  const plan = buildTodayPlan(data, today);
  const brief = composeMorningBrief(data, today);

  const heading = formatUkDate(today);

  return (
    <>
      <PageHeader
        title="Today"
        meta={`${heading} · ${data.workspace.name}`}
      />
      <Content>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="To handle today" value={plan.counts.total} />
          <Stat label="Overdue" value={plan.counts.overdue} tone={plan.counts.overdue ? "overdue" : undefined} />
          <Stat label="Rent expected" value={formatMoney(brief.money.in)} />
          <Stat label="Loan payments out" value={formatMoney(brief.money.out)} />
        </div>

        {/* Morning brief — the message the owner reads at 7:30am */}
        <Panel title="Morning brief">
          <div className="px-4 py-4 text-body">
            <p className="font-medium text-ink">
              {brief.greeting} {brief.headline}
            </p>
            <ul className="mt-2 space-y-1 text-ink-muted">
              {brief.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-meta text-ink-muted">
              Sent 07:30 to WhatsApp, email and push — one digest, not {plan.counts.total} separate alerts.
            </p>
          </div>
        </Panel>

        {plan.overdue.length > 0 && (
          <Section title="Overdue" items={plan.overdue} today={today} templateId={templateId} tone="overdue" />
        )}
        {plan.dueToday.length > 0 && (
          <Section title="Due today" items={plan.dueToday} today={today} templateId={templateId} />
        )}
        {plan.startSoon.length > 0 && (
          <Section
            title="Good to start today"
            subtitle="Long lead-time items whose booking window has opened."
            items={plan.startSoon}
            today={today}
            templateId={templateId}
          />
        )}

        {plan.counts.total === 0 && (
          <Panel>
            <div className="px-4 py-10 text-center text-ink-muted">
              Nothing needs your attention today. The next items appear under This week.
            </div>
          </Panel>
        )}
      </Content>
    </>
  );
}

function Section({
  title,
  subtitle,
  items,
  today,
  templateId,
  tone,
}: {
  title: string;
  subtitle?: string;
  items: ObligationView[];
  today: string;
  templateId: string;
  tone?: "overdue";
}) {
  return (
    <Panel
      title={title}
      right={<span className="tnum text-meta text-ink-muted">{items.length}</span>}
    >
      {subtitle ? <p className="border-b border-rule px-4 py-2 text-meta text-ink-muted">{subtitle}</p> : null}
      <ul>
        {items.slice(0, 40).map((ob) => (
          <li
            key={ob.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5 last:border-b-0"
          >
            <BandBadge band={ob.band} />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">{ob.title}</span>
              <span className="text-ink-muted"> · {ob.recordLabel} </span>
              <span className="tnum text-meta text-ink-muted">{ob.recordSublabel}</span>
              <span className="block text-meta text-ink-muted">{ob.why}</span>
            </span>
            <span className={`tnum text-meta ${tone === "overdue" ? "text-overdue" : "text-ink-muted"}`}>
              {ob.dueDate ? `${formatUkDate(ob.dueDate)} · ${relativeDue(ob.dueDate, today)}` : "watch"}
            </span>
            <a
              href={withTemplate(`/records/${ob.recordId}`, templateId)}
              className="rounded-ctl border border-rule px-2.5 py-1 text-meta font-medium text-ink hover:bg-canvas"
            >
              {ob.evidenceRequired ? "Upload evidence" : "Assign"}
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
