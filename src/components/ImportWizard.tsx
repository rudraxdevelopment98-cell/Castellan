"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Analysis {
  total: number;
  ready: number;
  errorRows: { rowIndex: number; errors: { field: string; message: string }[] }[];
}

export function ImportWizard({ slug, objectApiName }: { slug: string; objectApiName: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mappedFields, setMappedFields] = useState<string[]>([]);
  const [result, setResult] = useState<{ importId: string; created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(mode: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, slug, objectApiName, csv, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed"); return null; }
      return data;
    } catch { setError("Network error."); return null; }
    finally { setBusy(false); }
  }

  async function onFile(file: File) {
    setCsv(await file.text());
    setAnalysis(null); setResult(null);
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</p>}

      {!result && (
        <>
          <div className="space-y-2">
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="block text-table" />
            <textarea
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setAnalysis(null); }}
              rows={7}
              placeholder={"Or paste CSV with a header row:\nName,Postcode,Bedrooms,Rent\n22 Cable St,E1 8AB,2,1500"}
              className="w-full rounded-ctl border border-rule bg-surface px-3 py-2 font-mono text-meta text-ink"
            />
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy || !csv.trim()}
              onClick={async () => { const d = await call("analyze"); if (d) { setAnalysis(d.analysis); setMappedFields(d.mappedFields ?? []); } }}
              className="rounded-ctl border border-rule px-3 py-2 text-table font-medium text-ink hover:bg-canvas disabled:opacity-50"
            >
              {busy ? "Checking…" : "Check the file"}
            </button>
          </div>
        </>
      )}

      {analysis && !result && (
        <div className="rounded-panel border border-rule bg-surface p-4">
          <p className="text-body text-ink">
            Matched columns: <span className="font-medium">{mappedFields.join(", ") || "none"}</span>
          </p>
          <div className="mt-2 grid grid-cols-3 gap-px bg-rule">
            <div className="bg-surface px-3 py-2"><div className="tnum text-section font-semibold text-ink">{analysis.total}</div><div className="text-meta text-ink-muted">Rows</div></div>
            <div className="bg-surface px-3 py-2"><div className="tnum text-section font-semibold text-ok">{analysis.ready}</div><div className="text-meta text-ink-muted">Ready</div></div>
            <div className="bg-surface px-3 py-2"><div className="tnum text-section font-semibold text-overdue">{analysis.errorRows.length}</div><div className="text-meta text-ink-muted">Will be skipped</div></div>
          </div>
          {analysis.errorRows.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-meta text-ink-muted">
              {analysis.errorRows.slice(0, 20).map((r) => (
                <li key={r.rowIndex}>Row {r.rowIndex + 2}: {r.errors.map((e) => `${e.field} — ${e.message}`).join("; ")}</li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || analysis.ready === 0}
            onClick={async () => { const d = await call("commit"); if (d) setResult(d); }}
            className="mt-3 rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Import {analysis.ready} valid row{analysis.ready === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-panel border border-ok/40 bg-ok/10 p-4">
          <p className="text-body text-ink">Imported {result.created} record{result.created === 1 ? "" : "s"}{result.skipped ? `, skipped ${result.skipped}` : ""}.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => router.push(`/w/${slug}/o/${objectApiName}`)} className="rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white hover:opacity-90">View records</button>
            <button
              disabled={busy}
              onClick={async () => { const d = await call("undo", { importId: result.importId }); if (d) { setResult(null); setAnalysis(null); setCsv(""); } }}
              className="rounded-ctl border border-rule px-3 py-2 text-table text-ink hover:bg-canvas disabled:opacity-50"
            >
              Undo this import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
