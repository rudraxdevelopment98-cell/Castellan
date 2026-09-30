import { Content, PageHeader, Panel } from "@/components/primitives";
import { ask, askExamples } from "@/lib/domain/ask";
import { resolveContext, withTemplate, type SearchParams } from "@/lib/domain/params";

export default async function AskPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, today, templateId } = await resolveContext(searchParams);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const result = q ? ask(data, q, today) : null;

  return (
    <>
      <PageHeader
        title="Ask"
        meta="Answers come only from your own data, and every answer cites the records it used."
      />
      <Content>
        {/* Search box — not a chat mascot (ai_presence_in_ui). */}
        <form method="get" className="flex flex-wrap gap-2">
          {templateId !== "uk-landlord" && <input type="hidden" name="t" value={templateId} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Ask about your portfolio…"
            className="min-w-0 flex-1 rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted"
            aria-label="Ask a question"
          />
          <button className="rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90">
            Ask
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {askExamples.map((ex) => (
            <a
              key={ex}
              href={withTemplate(`/ask?q=${encodeURIComponent(ex)}`, templateId)}
              className="rounded-ctl border border-rule bg-surface px-2.5 py-1 text-meta text-ink hover:bg-canvas"
            >
              {ex}
            </a>
          ))}
        </div>

        {result && (
          <Panel title="Answer">
            <div className="px-4 py-3">
              <p className="text-body font-medium text-ink">{result.answer}</p>
              {result.note && <p className="mt-1 text-meta text-due-soon">{result.note}</p>}
            </div>
            {result.rows.length > 0 && (
              <div className="overflow-x-auto border-t border-rule">
                <table className="w-full border-collapse text-table">
                  <thead>
                    <tr className="border-b border-rule text-left text-ink-muted">
                      {result.columns.map((c) => (
                        <th key={c} className="px-4 py-2 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 100).map((row, i) => (
                      <tr key={i} className="border-b border-rule hover:bg-canvas last:border-b-0">
                        {row.cells.map((cell, j) => (
                          <td key={j} className="tnum px-4 py-1.5">
                            {j === 0 && row.recordId ? (
                              <a
                                href={withTemplate(`/records/${row.recordId}`, templateId)}
                                className="font-medium text-ink hover:text-brand"
                              >
                                {cell}
                              </a>
                            ) : (
                              <span className={j === 0 ? "text-ink" : "text-ink-muted"}>{cell}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-rule px-4 py-2 text-meta text-ink-muted">
              {result.citationLabel} · Read-only: any action would need your explicit confirmation.
            </p>
          </Panel>
        )}
      </Content>
    </>
  );
}
