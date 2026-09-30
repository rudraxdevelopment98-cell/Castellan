import { Content, PageHeader } from "@/components/primitives";
import { RecordsTable, type RecordRow } from "@/components/RecordsTable";
import { formatUkDate } from "@/lib/rules/dates";
import { formatMoney, relativeDue } from "@/lib/domain/format";
import { buildObligationViews } from "@/lib/domain/views";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

export default async function RecordsPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, today, templateId } = await resolveContext(searchParams);
  const views = buildObligationViews(data, today);

  // Precompute next-due + overdue count per record.
  const byRecord = new Map<string, { next?: string; overdue: number }>();
  for (const v of views) {
    const entry = byRecord.get(v.recordId) ?? { overdue: 0 };
    if (v.band === "overdue") entry.overdue += 1;
    if (v.dueDate && (!entry.next || v.dueDate < entry.next)) entry.next = v.dueDate;
    byRecord.set(v.recordId, entry);
  }

  const rows: RecordRow[] = data.records.map((r) => {
    const agg = byRecord.get(r.id) ?? { overdue: 0 };
    return {
      id: r.id,
      label: r.label,
      sublabel: r.sublabel ?? "",
      borough: String(r.fields.borough ?? "—"),
      type: String(r.fields.type ?? r.recordTypeId),
      epc: String(r.fields.epc_rating ?? "—"),
      rent: r.fields.rent_pcm ? formatMoney(Number(r.fields.rent_pcm)) : "—",
      nextDue: agg.next ?? "",
      nextDueLabel: agg.next ? `${formatUkDate(agg.next)} · ${relativeDue(agg.next, today)}` : "—",
      overdueCount: agg.overdue,
      href: withTemplate(`/records/${r.id}`, templateId),
    };
  });

  return (
    <>
      <PageHeader
        title={data.workspace.recordNounPlural}
        meta={`${data.records.length} ${data.workspace.recordNounPlural.toLowerCase()} · ${data.workspace.name}`}
      />
      <Content>
        <div className="overflow-hidden rounded-panel border border-rule bg-surface">
          <RecordsTable rows={rows} recordNoun={data.workspace.recordNoun} />
        </div>
      </Content>
    </>
  );
}
