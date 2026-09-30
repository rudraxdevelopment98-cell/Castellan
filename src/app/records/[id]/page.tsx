import { notFound } from "next/navigation";
import { Content, PageHeader, Panel } from "@/components/primitives";
import { BandBadge, StatusSquare } from "@/components/status";
import { formatUkDate } from "@/lib/rules/dates";
import { cellStatus, generateObligation, ruleApplies, urgencyBand } from "@/lib/rules/engine";
import { relativeDue } from "@/lib/domain/format";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

export default async function RecordDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { data, today, templateId } = await resolveContext(searchParams);
  const record = data.records.find((r) => r.id === id);
  if (!record) notFound();

  const obligations = data.template.rules
    .filter((rule) => ruleApplies(record, rule))
    .map((rule) => ({ rule, ob: generateObligation(record, rule)!, cell: cellStatus(record, rule, today) }))
    .filter((x) => x.ob);

  const type = data.template.recordTypes.find((t) => t.id === record.recordTypeId);
  const docs = data.documents.filter((d) => d.recordId === record.id);

  return (
    <>
      <PageHeader
        title={record.label}
        meta={`${record.sublabel ?? ""} · ${data.workspace.recordNoun}`}
        actions={
          <a
            href={withTemplate("/records", templateId)}
            className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas"
          >
            ← All {data.workspace.recordNounPlural.toLowerCase()}
          </a>
        }
      />
      <Content>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            <Panel title="Obligations">
              <ul>
                {obligations.map(({ rule, ob, cell }) => (
                  <li key={rule.code} className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
                    <StatusSquare status={cell} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink">{ob.title}</span>
                      <span className="block text-meta text-ink-muted">{ob.why}</span>
                    </span>
                    <span className="text-right">
                      <BandBadge band={urgencyBand(ob, today)} />
                      <span className="tnum mt-0.5 block text-meta text-ink-muted">
                        {ob.dueDate ? `${formatUkDate(ob.dueDate)} · ${relativeDue(ob.dueDate, today)}` : "watch"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Documents">
              {docs.length === 0 ? (
                <div className="px-4 py-8 text-center text-ink-muted">
                  No documents linked yet. Scan or drop a certificate to start.
                </div>
              ) : (
                <ul>
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between border-b border-rule px-4 py-2.5 last:border-b-0">
                      <span className="text-ink">{d.fileName}</span>
                      <span className="text-meta text-ink-muted">{d.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Details">
              <dl className="divide-y divide-rule">
                {type?.fields.map((f) => {
                  const raw = record.fields[f.key];
                  const value = f.sensitive
                    ? "•••• (encrypted)"
                    : raw === true
                      ? "Yes"
                      : raw === false
                        ? "No"
                        : raw === null || raw === undefined
                          ? "—"
                          : String(raw);
                  return (
                    <div key={f.key} className="flex items-center justify-between px-4 py-2">
                      <dt className="text-meta text-ink-muted">{f.label}</dt>
                      <dd className={`tnum text-table ${f.sensitive ? "text-ink-muted" : "text-ink"}`}>{value}</dd>
                    </div>
                  );
                })}
              </dl>
            </Panel>
            <p className="text-meta text-ink-muted">
              Sensitive fields (key safe codes, account references) are field-level
              encrypted at rest and access to them is written to the audit log.
            </p>
          </div>
        </div>
      </Content>
    </>
  );
}
