"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface DocItem {
  id: string;
  title: string | null;
  filename: string;
  mime: string;
  size: number;
  docType: string | null;
  keyDate: string | null;
  reminderDays: number[];
  note: string | null;
  recordId: string | null;
  createdAt: string;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const parts = iso.split("T")[0]!.split("-");
  const [y, m, d] = parts;
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function relative(keyDate: string | null): { label: string; tone: "overdue" | "soon" | "ok" } | null {
  if (!keyDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${keyDate.split("T")[0]}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `overdue by ${Math.abs(days)}d`, tone: "overdue" };
  if (days === 0) return { label: "due today", tone: "overdue" };
  if (days <= 30) return { label: `in ${days}d`, tone: "soon" };
  return { label: `in ${days}d`, tone: "ok" };
}

export function DocumentsManager({
  slug,
  documents,
  recordId,
  objectApiName,
  docTypeOptions = [],
  compact = false,
}: {
  slug: string;
  documents: DocItem[];
  recordId?: string;
  objectApiName?: string;
  docTypeOptions?: string[];
  compact?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  // Relative countdowns depend on "now", so only render them after mount to
  // avoid a server/client hydration mismatch (which can break interactivity).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("slug", slug);
    if (recordId) fd.set("recordId", recordId);
    if (objectApiName) fd.set("objectApiName", objectApiName);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Please choose a file.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setError(json?.error || "Upload failed.");
      } else {
        form.reset();
        router.refresh();
      }
    } catch {
      setError("Upload failed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Remove this document?")) return;
    await fetch("/api/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, id }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {compact && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-ctl border border-rule bg-surface px-3 py-1.5 text-table font-medium text-ink hover:bg-canvas"
        >
          {open ? "Close" : "Upload a document"}
        </button>
      )}

      {open && (
        <form
          ref={formRef}
          onSubmit={onUpload}
          className="space-y-3 rounded-panel border border-rule bg-surface p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-meta text-ink-muted">File (PDF, image or document — max 15 MB)</span>
              <input
                name="file"
                type="file"
                required
                className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink file:mr-3 file:rounded-ctl file:border-0 file:bg-brand file:px-3 file:py-1 file:text-white"
              />
            </label>
            <label className="block">
              <span className="text-meta text-ink-muted">Title (optional)</span>
              <input name="title" className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink" placeholder="e.g. Home insurance 2026" />
            </label>
            <label className="block">
              <span className="text-meta text-ink-muted">Type (optional)</span>
              <input name="docType" list="doc-types" className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink" placeholder="e.g. Insurance, Passport, MOT" />
              <datalist id="doc-types">
                {docTypeOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-meta text-ink-muted">Key date — expiry / renewal (optional)</span>
              <input name="keyDate" type="date" className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink" />
            </label>
            <label className="block">
              <span className="text-meta text-ink-muted">Remind me before (days)</span>
              <input name="reminderDays" defaultValue="30,7,1" className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink" placeholder="30,7,1" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-meta text-ink-muted">Note (optional)</span>
              <input name="note" className="mt-1 w-full rounded-ctl border border-rule bg-canvas px-3 py-2 text-body text-ink" />
            </label>
          </div>
          {error && (
            <p className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</p>
          )}
          <button
            disabled={busy}
            className="rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload document"}
          </button>
        </form>
      )}

      {documents.length === 0 ? (
        <p className="rounded-panel border border-dashed border-rule bg-canvas px-4 py-6 text-center text-body text-ink-muted">
          No documents yet. Upload a file above — add a key date and we&apos;ll remind you before it expires.
        </p>
      ) : (
        <div className="overflow-hidden rounded-panel border border-rule bg-surface">
          <table className="w-full text-left text-table">
            <thead className="border-b border-rule text-meta text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Document</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Key date</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => {
                const rel = mounted ? relative(d.keyDate) : null;
                return (
                  <tr key={d.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5">
                      <a
                        href={`/api/documents/${d.id}?slug=${encodeURIComponent(slug)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand hover:underline"
                      >
                        {d.title || d.filename}
                      </a>
                      {d.note ? <div className="text-meta text-ink-muted">{d.note}</div> : null}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{d.docType || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="tnum text-ink">{fmtDate(d.keyDate)}</span>
                      {rel ? (
                        <span
                          className={`ml-2 rounded-ctl px-1.5 py-0.5 text-meta ${
                            rel.tone === "overdue"
                              ? "bg-overdue/10 text-overdue"
                              : rel.tone === "soon"
                                ? "bg-amber-500/10 text-amber-600"
                                : "bg-ok/10 text-ok"
                          }`}
                        >
                          {rel.label}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tnum text-ink-muted">{fmtSize(d.size)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDelete(d.id)}
                        className="text-meta text-ink-muted hover:text-overdue"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
