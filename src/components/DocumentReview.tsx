"use client";

import { useState } from "react";

export interface ReviewField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  page: number;
  snippet?: string;
  critical: boolean;
}

export interface ReviewDoc {
  id: string;
  fileName: string;
  typeName: string;
  recordSuggestion?: { label: string; confidence: number };
  fields: ReviewField[];
  threshold: number;
}

/**
 * The review screen. Document on the (represented) left, extracted fields on
 * the right. Every critical field, or anything below the confidence threshold,
 * must be ticked before the document can be confirmed — nothing creates a legal
 * reminder from an unreviewed date (document_ai_pipeline step 7).
 */
export function DocumentReview({ doc }: { doc: ReviewDoc }) {
  const needsTick = (f: ReviewField) => f.critical || f.confidence < doc.threshold;
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [committed, setCommitted] = useState(false);

  const outstanding = doc.fields.filter((f) => needsTick(f) && !confirmed[f.key]);
  const canCommit = outstanding.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Document surface (stand-in for the rendered page image) */}
      <div className="rounded-panel border border-rule bg-canvas">
        <div className="border-b border-rule px-4 py-2 text-meta text-ink-muted">{doc.fileName}</div>
        <div className="flex min-h-[360px] flex-col gap-3 p-6">
          {doc.fields.map((f) => (
            <div key={f.key} className="rounded-ctl border border-rule bg-surface px-3 py-2">
              <div className="text-meta text-ink-muted">Page {f.page}</div>
              <div className="text-table text-ink">{f.snippet ?? f.value}</div>
            </div>
          ))}
          {doc.fields.length === 0 && (
            <div className="m-auto text-ink-muted">Not yet read.</div>
          )}
        </div>
      </div>

      {/* Extracted fields */}
      <div className="rounded-panel border border-rule bg-surface">
        <div className="flex items-center justify-between border-b border-rule px-4 py-2">
          <span className="text-table font-medium text-ink">{doc.typeName}</span>
          {doc.recordSuggestion && (
            <span className="text-meta text-ink-muted">
              Match: {doc.recordSuggestion.label} ({Math.round(doc.recordSuggestion.confidence * 100)}%)
            </span>
          )}
        </div>
        <ul>
          {doc.fields.map((f) => {
            const low = f.confidence < doc.threshold;
            const done = confirmed[f.key];
            return (
              <li key={f.key} className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="text-meta text-ink-muted">{f.label}</span>
                  <span className="tnum block text-table font-medium text-ink">{f.value}</span>
                </span>
                <span
                  className={`tnum text-meta ${low ? "text-due-soon" : "text-ok"}`}
                  title="Extraction confidence"
                >
                  {Math.round(f.confidence * 100)}%
                </span>
                {needsTick(f) ? (
                  <button
                    onClick={() => setConfirmed((c) => ({ ...c, [f.key]: !c[f.key] }))}
                    className={`rounded-ctl border px-2.5 py-1 text-meta font-medium ${
                      done
                        ? "border-ok bg-ok/10 text-ok"
                        : "border-rule bg-surface text-ink hover:bg-canvas"
                    }`}
                  >
                    {done ? "Confirmed ✓" : f.critical ? "Confirm (required)" : "Confirm"}
                  </button>
                ) : (
                  <span className="text-meta text-ink-muted">auto</span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-meta text-ink-muted">
            {outstanding.length === 0
              ? "All required fields confirmed."
              : `${outstanding.length} field${outstanding.length === 1 ? "" : "s"} still need confirming.`}
          </span>
          <button
            disabled={!canCommit || committed}
            onClick={() => setCommitted(true)}
            className={`rounded-ctl px-3 py-1.5 text-table font-medium ${
              canCommit && !committed
                ? "bg-brand text-white hover:opacity-90"
                : "cursor-not-allowed border border-rule bg-canvas text-ink-muted"
            }`}
          >
            {committed ? "Committed — obligations updated" : "Confirm & commit"}
          </button>
        </div>
        {committed && (
          <p className="border-t border-rule px-4 py-3 text-meta text-ok">
            Facts written, next-cycle obligation generated, audit log recorded who confirmed what.
          </p>
        )}
      </div>
    </div>
  );
}
