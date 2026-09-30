"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface RecordRow {
  id: string;
  label: string;
  sublabel: string;
  borough: string;
  type: string;
  epc: string;
  rent: string;
  nextDue: string;
  nextDueLabel: string;
  overdueCount: number;
  href: string;
}

const SAVED_FILTERS: { name: string; test: (r: RecordRow) => boolean }[] = [
  { name: "All", test: () => true },
  { name: "Overdue", test: (r) => r.overdueCount > 0 },
  { name: "EPC D or below", test: (r) => ["D", "E", "F", "G"].includes(r.epc) },
  { name: "HMOs", test: (r) => r.type === "HMO" },
  { name: "Hackney", test: (r) => r.borough === "Hackney" },
];

export function RecordsTable({ rows, recordNoun }: { rows: RecordRow[]; recordNoun: string }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");

  const filtered = useMemo(() => {
    const active = SAVED_FILTERS.find((f) => f.name === filter) ?? SAVED_FILTERS[0]!;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        active.test(r) &&
        (needle === "" ||
          r.label.toLowerCase().includes(needle) ||
          r.sublabel.toLowerCase().includes(needle) ||
          r.borough.toLowerCase().includes(needle)),
    );
  }, [rows, q, filter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${recordNoun.toLowerCase()}, postcode or borough…`}
          className="w-64 rounded-ctl border border-rule bg-surface px-3 py-1.5 text-table text-ink placeholder:text-ink-muted"
          aria-label={`Search ${recordNoun}`}
        />
        <div className="flex flex-wrap gap-1">
          {SAVED_FILTERS.map((f) => (
            <button
              key={f.name}
              onClick={() => setFilter(f.name)}
              className={`rounded-ctl border px-2.5 py-1 text-meta font-medium transition-colors ${
                filter === f.name
                  ? "border-brand bg-brand-weak text-brand"
                  : "border-rule bg-surface text-ink hover:bg-canvas"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <span className="tnum ml-auto text-meta text-ink-muted">{filtered.length} shown</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="border-b border-rule text-left text-ink-muted">
              <th className="px-4 py-2 font-medium">{recordNoun}</th>
              <th className="px-2 py-2 font-medium">Borough</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 text-center font-medium">EPC</th>
              <th className="px-2 py-2 text-right font-medium">Rent (pcm)</th>
              <th className="px-2 py-2 font-medium">Next due</th>
              <th className="px-2 py-2 text-center font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r) => (
              <tr key={r.id} className="border-b border-rule hover:bg-canvas">
                <td className="px-4 py-1.5">
                  <Link href={r.href} className="font-medium text-ink hover:text-brand">
                    {r.label}
                  </Link>
                  <span className="tnum block text-meta text-ink-muted">{r.sublabel}</span>
                </td>
                <td className="px-2 py-1.5 text-ink-muted">{r.borough}</td>
                <td className="px-2 py-1.5 text-ink-muted">{r.type}</td>
                <td className="px-2 py-1.5 text-center">{r.epc}</td>
                <td className="tnum px-2 py-1.5 text-right">{r.rent}</td>
                <td className="tnum px-2 py-1.5 text-ink-muted">{r.nextDueLabel}</td>
                <td className="tnum px-2 py-1.5 text-center">
                  {r.overdueCount > 0 ? (
                    <span className="font-semibold text-overdue">{r.overdueCount}</span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="px-4 py-3 text-meta text-ink-muted">
            Showing first 200 of {filtered.length}. Narrow with search or a filter.
          </p>
        )}
      </div>
    </div>
  );
}
