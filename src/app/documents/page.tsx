import { Content, PageHeader, Panel } from "@/components/primitives";
import { DocumentReview, type ReviewDoc } from "@/components/DocumentReview";
import { resolveContext, type SearchParams } from "@/lib/domain/params";

const STATUS_STEPS = ["received", "read", "needs_review", "confirmed"] as const;
const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  read: "Read",
  needs_review: "Needs review",
  confirmed: "Confirmed",
};

const THRESHOLD = 0.9; // admin-editable in production

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { data } = await resolveContext(searchParams);
  const docs = data.documents;

  const counts = Object.fromEntries(
    STATUS_STEPS.map((s) => [s, docs.filter((d) => d.status === s).length]),
  );

  const typeName = (id: string) =>
    data.template.documentTypes.find((t) => t.id === id)?.name ?? id;
  const recordLabel = (id?: string) =>
    id ? data.records.find((r) => r.id === id)?.label ?? id : undefined;

  const reviewDocs: ReviewDoc[] = docs
    .filter((d) => d.status === "needs_review")
    .map((d) => {
      const critByKey = new Map(
        (data.template.documentTypes.find((t) => t.id === d.documentTypeId)?.fieldSchema ?? []).map(
          (f) => [f.key, Boolean(f.critical)],
        ),
      );
      const sug = d.recordMatchSuggestions?.[0];
      return {
        id: d.id,
        fileName: d.fileName,
        typeName: typeName(d.documentTypeId),
        recordSuggestion: sug
          ? { label: recordLabel(sug.recordId) ?? sug.recordId, confidence: sug.confidence }
          : undefined,
        threshold: THRESHOLD,
        fields: d.extracted.map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          confidence: f.confidence,
          page: f.page,
          snippet: f.snippet,
          critical: critByKey.get(f.key) ?? false,
        })),
      };
    });

  return (
    <>
      <PageHeader
        title="Documents"
        meta="Turn paper into trusted data. Received → Read → Needs review → Confirmed."
        actions={
          <span className="rounded-ctl border border-dashed border-rule px-3 py-1.5 text-table text-ink-muted">
            Drag & drop · phone scan · forward to inbox email
          </span>
        }
      />
      <Content>
        {/* Processing inbox pipeline */}
        <Panel title="Processing inbox">
          <div className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
            {STATUS_STEPS.map((s) => (
              <div key={s} className="bg-surface px-4 py-3">
                <div className="tnum text-section font-semibold text-ink">{counts[s]}</div>
                <div className="text-meta text-ink-muted">{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Review queue */}
        <div>
          <h2 className="mb-2 text-section font-semibold text-ink">Review queue</h2>
          {reviewDocs.length === 0 ? (
            <Panel>
              <div className="px-4 py-8 text-center text-ink-muted">Nothing to review. Good.</div>
            </Panel>
          ) : (
            <div className="space-y-6">
              {reviewDocs.map((d) => (
                <DocumentReview key={d.id} doc={d} />
              ))}
            </div>
          )}
        </div>

        <p className="text-meta text-ink-muted">
          Confidence threshold {Math.round(THRESHOLD * 100)}% (admin-editable). Any critical
          date or money field, or anything below the threshold, requires a human tick.
          Text inside documents is treated as data, never as instructions to the AI.
        </p>
      </Content>
    </>
  );
}
