import { Content, PageHeader, Panel, Stat } from "@/components/primitives";
import { StatusLegend, StatusSquare } from "@/components/status";
import { buildMatrix, registrationReadiness } from "@/lib/domain/views";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

const ROW_LIMIT = 60; // render a readable slice; full portfolio is paginated in prod

export default async function CompliancePage({ searchParams }: { searchParams: SearchParams }) {
  const { data, today, templateId } = await resolveContext(searchParams);
  const matrix = buildMatrix(data, today, ROW_LIMIT);
  const readiness = registrationReadiness(data, today);
  const total = data.records.length;

  return (
    <>
      <PageHeader
        title="Compliance"
        meta={`Every ${data.workspace.recordNoun.toLowerCase()} × every requirement · showing ${matrix.rows.length} of ${total}`}
      />
      <Content>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Overdue cells" value={matrix.totals.overdue} tone={matrix.totals.overdue ? "overdue" : undefined} />
          <Stat label="Due soon" value={matrix.totals.due_soon} />
          <Stat label="Missing evidence" value={matrix.totals.missing} />
          <Stat
            label="Ready to register (PRS)"
            value={`${readiness.ready} / ${readiness.total}`}
            tone="ok"
          />
        </div>

        <Panel title="Compliance matrix" right={<StatusLegend />}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-table">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium text-ink-muted">
                    {data.workspace.recordNoun}
                  </th>
                  {matrix.categories.map((c) => (
                    <th key={c} className="px-2 py-2 text-center font-medium text-ink-muted">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.record.id} className="border-b border-rule hover:bg-canvas">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">
                      <a
                        href={withTemplate(`/records/${row.record.id}`, templateId)}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {row.record.label}
                      </a>
                      <span className="tnum block text-meta text-ink-muted">{row.record.sublabel}</span>
                    </td>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-2 py-1.5 text-center">
                        <StatusSquare status={cell.status} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="text-meta text-ink-muted">
          Status is shown by colour, glyph and label together, so the grid is legible
          in greyscale and to colour-blind users (WCAG 2.2 AA).
        </p>
      </Content>
    </>
  );
}
