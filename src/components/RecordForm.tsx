"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FormField {
  apiName: string;
  label: string;
  type: string;
  required?: boolean;
  config?: Record<string, unknown> | null;
}

export function RecordForm({
  slug,
  objectApiName,
  fields,
  mode,
  recordId,
  version,
  initial,
}: {
  slug: string;
  objectApiName: string;
  fields: FormField[];
  mode: "create" | "edit";
  recordId?: string;
  version?: number;
  initial?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      const iv = initial?.[f.apiName];
      if (iv !== undefined && iv !== null) v[f.apiName] = f.type === "boolean" ? (iv ? "true" : "false") : String(iv);
    }
    return v;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(api: string, value: string) {
    setValues((v) => ({ ...v, [api]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "auto_number") continue;
      const raw = values[f.apiName];
      if (raw === undefined) continue;
      input[f.apiName] = f.type === "boolean" ? raw === "true" : raw;
    }
    try {
      const res = await fetch("/api/records", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create"
            ? { slug, objectApiName, input }
            : { slug, recordId, input, expectedVersion: version },
        ),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push(`/w/${slug}/o/${objectApiName}/${data.recordId ?? recordId}`);
        router.refresh();
        return;
      }
      if (data.errors) {
        const fe: Record<string, string> = {};
        for (const e of data.errors) fe[e.field] = e.message;
        setErrors(fe);
        setFormError("Some fields need attention.");
      } else if (data.conflict) {
        setFormError(`This record changed since you opened it (fields: ${(data.fields ?? []).join(", ")}). Reload and try again.`);
      } else {
        setFormError(data.error ?? "Could not save.");
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      className="space-y-3"
    >
      {formError && (
        <p className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{formError}</p>
      )}
      {fields.filter((f) => f.type !== "auto_number").map((f) => {
        const opts = (f.config?.options as { id: string; label?: string }[] | undefined) ?? [];
        return (
          <label key={f.apiName} className="block">
            <span className="text-meta text-ink-muted">{f.label}{f.required ? " (required)" : ""}</span>
            {f.type === "single_select" || f.type === "status" ? (
              <select value={values[f.apiName] ?? ""} onChange={(e) => set(f.apiName, e.target.value)} className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink">
                <option value="">—</option>
                {opts.map((o) => <option key={o.id} value={o.id}>{o.label ?? o.id}</option>)}
              </select>
            ) : f.type === "boolean" ? (
              <select value={values[f.apiName] ?? ""} onChange={(e) => set(f.apiName, e.target.value)} className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink">
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : f.type === "long_text" ? (
              <textarea value={values[f.apiName] ?? ""} onChange={(e) => set(f.apiName, e.target.value)} rows={3} className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
            ) : (
              <input
                type={f.type === "sensitive_text" ? "password" : "text"}
                value={values[f.apiName] ?? ""}
                onChange={(e) => set(f.apiName, e.target.value)}
                placeholder={f.type === "date" ? "DD/MM/YYYY" : f.type === "currency" ? "e.g. 1200" : ""}
                className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
              />
            )}
            {errors[f.apiName] && <span className="mt-1 block text-meta text-overdue">{errors[f.apiName]}</span>}
          </label>
        );
      })}
      <button disabled={busy} className="rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90 disabled:opacity-50">
        {busy ? "Saving…" : mode === "create" ? "Create record" : "Save changes"}
      </button>
    </form>
  );
}
