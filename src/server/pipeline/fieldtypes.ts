import { isValidIsoDate } from "../../lib/rules/dates";

/**
 * Field-type registry: per-type sanitise + normalise + validate. Pure and
 * dependency-free so it is exhaustively unit-tested (spec data_processing_pipeline).
 * DB-dependent checks (unique, relation/person existence) live in pipeline.ts,
 * which calls these first. formula/rollup/lookup are deferred (Phase 6).
 */

export type FieldType =
  | "text" | "long_text" | "number" | "currency" | "percent" | "date"
  | "datetime" | "duration" | "boolean" | "single_select" | "multi_select"
  | "status" | "email" | "phone" | "url" | "address" | "person" | "relation"
  | "file" | "sensitive_text" | "auto_number";

export interface FieldDefLite {
  apiName: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  config?: Record<string, unknown>;
  defaultValue?: unknown;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
  valueReceived: unknown;
  suggestion?: string;
}

export type FieldResult = { ok: true; value: unknown } | { ok: false; error: FieldError };

const ok = (value: unknown): FieldResult => ({ ok: true, value });
const err = (field: FieldDefLite, code: string, message: string, valueReceived: unknown, suggestion?: string): FieldResult =>
  ({ ok: false, error: { field: field.apiName, code, message, valueReceived, suggestion } });

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// --- Generic string sanitising (spec: trim, collapse spaces, strip controls, NFC) ---
export function sanitiseText(raw: unknown): string {
  let s = String(raw);
  s = s.normalize("NFC");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // control chars
  s = s.replace(/[ \t]+/g, " ").trim();
  return s;
}

// --- UK postcode: uppercase, single space before the 3-char inward code ---
export function normaliseUkPostcode(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return raw.toUpperCase().trim();
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

// --- UK-first date parsing -> ISO YYYY-MM-DD ---
export function parseUkDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidIsoDate(s) ? s : null;
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

function parseMoneyToMinor(raw: unknown): number | null {
  if (typeof raw === "number") return Math.round(raw * 100);
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function normalisePhone(raw: string, defaultCountry?: string): string | null {
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    if ((defaultCountry ?? "GB").toUpperCase() === "GB") {
      s = s.replace(/^0/, "");
      s = "+44" + s;
    } else {
      return null; // unknown country, needs explicit +code
    }
  }
  return /^\+\d{7,15}$/.test(s) ? s : null;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
function optionIds(field: FieldDefLite): { id: string; label?: string }[] {
  const opts = (field.config?.options as { id: string; label?: string }[] | undefined) ?? [];
  return opts;
}
function resolveOption(field: FieldDefLite, raw: unknown): string | null {
  const val = sanitiseText(raw);
  const opts = optionIds(field);
  const byId = opts.find((o) => o.id === val);
  if (byId) return byId.id;
  const byLabel = opts.find((o) => (o.label ?? o.id).toLowerCase() === val.toLowerCase());
  return byLabel ? byLabel.id : null;
}

/** Sanitise + normalise + (local) validate one field value. */
export function processField(raw: unknown, field: FieldDefLite): FieldResult {
  if (isEmpty(raw)) {
    if (field.required) return err(field, "required", `${field.label} is required.`, raw);
    return ok(null);
  }

  switch (field.type) {
    case "text":
    case "sensitive_text": {
      const s = sanitiseText(raw);
      const max = field.config?.maxLength as number | undefined;
      if (max && s.length > max) return err(field, "too_long", `${field.label} must be ${max} characters or fewer.`, raw);
      const pattern = field.config?.pattern as string | undefined;
      if (pattern && !new RegExp(pattern).test(s)) return err(field, "pattern", `${field.label} is not in the expected format.`, raw);
      return ok(s);
    }
    case "long_text": {
      const s = String(raw).normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
      const max = field.config?.maxLength as number | undefined;
      if (max && s.length > max) return err(field, "too_long", `${field.label} must be ${max} characters or fewer.`, raw);
      return ok(s);
    }
    case "number":
    case "percent":
    case "duration": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return err(field, "not_a_number", `${field.label} must be a number.`, raw);
      const min = field.config?.min as number | undefined;
      const max = field.config?.max as number | undefined;
      if (min !== undefined && n < min) return err(field, "min", `${field.label} must be at least ${min}.`, raw);
      if (max !== undefined && n > max) return err(field, "max", `${field.label} must be at most ${max}.`, raw);
      return ok(n);
    }
    case "currency": {
      const minor = parseMoneyToMinor(raw);
      if (minor === null) return err(field, "not_money", `${field.label} must be an amount.`, raw);
      return ok(minor); // stored as integer minor units
    }
    case "date": {
      const iso = parseUkDate(String(raw));
      if (!iso) return err(field, "not_a_date", `${field.label} is not a valid date.`, raw, "Use DD/MM/YYYY or YYYY-MM-DD.");
      return ok(iso);
    }
    case "datetime": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) return err(field, "not_a_datetime", `${field.label} is not a valid date/time.`, raw);
      return ok(d.toISOString()); // stored UTC
    }
    case "boolean": {
      if (typeof raw === "boolean") return ok(raw);
      const s = sanitiseText(raw).toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return ok(true);
      if (["false", "no", "n", "0"].includes(s)) return ok(false);
      return err(field, "not_boolean", `${field.label} must be yes or no.`, raw);
    }
    case "single_select":
    case "status": {
      const id = resolveOption(field, raw);
      if (!id) return err(field, "bad_option", `${field.label}: "${sanitiseText(raw)}" is not a valid option.`, raw);
      return ok(id);
    }
    case "multi_select": {
      const ids: string[] = [];
      for (const item of asArray(raw)) {
        const id = resolveOption(field, item);
        if (!id) return err(field, "bad_option", `${field.label}: "${sanitiseText(item)}" is not a valid option.`, raw);
        ids.push(id);
      }
      const maxSel = field.config?.maxSelections as number | undefined;
      if (maxSel && ids.length > maxSel) return err(field, "too_many", `${field.label}: choose at most ${maxSel}.`, raw);
      return ok(Array.from(new Set(ids)));
    }
    case "email": {
      const s = sanitiseText(raw).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return err(field, "bad_email", `${field.label} is not a valid email.`, raw);
      return ok(s);
    }
    case "phone": {
      const p = normalisePhone(sanitiseText(raw), field.config?.defaultCountry as string | undefined);
      if (!p) return err(field, "bad_phone", `${field.label} is not a valid phone number.`, raw, "Include the country code, e.g. +44…");
      return ok(p);
    }
    case "url": {
      let s = sanitiseText(raw);
      if (!/^https?:\/\//i.test(s)) s = "https://" + s;
      try {
        return ok(new URL(s).toString());
      } catch {
        return err(field, "bad_url", `${field.label} is not a valid URL.`, raw);
      }
    }
    case "address": {
      const obj: Record<string, unknown> =
        typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : { line1: sanitiseText(raw) };
      if (typeof obj.postcode === "string") obj.postcode = normaliseUkPostcode(obj.postcode);
      return ok(obj);
    }
    case "person":
    case "relation": {
      // Format only here; existence + scope are checked in pipeline.ts with the tx.
      const ids = asArray(raw).map((v) => sanitiseText(v)).filter(Boolean);
      const bad = ids.find((id) => !/^[0-9a-f-]{36}$/i.test(id));
      if (bad) return err(field, "bad_reference", `${field.label} has an invalid reference.`, raw);
      const single = field.config?.multiple !== true;
      if (single && ids.length > 1) return err(field, "too_many_refs", `${field.label} accepts a single value.`, raw);
      return ok(single ? (ids[0] ?? null) : ids);
    }
    case "file": {
      return ok(asArray(raw).map((v) => sanitiseText(v)));
    }
    case "auto_number": {
      // Generated by the engine on create; never accepted from input.
      return err(field, "read_only", `${field.label} is generated automatically.`, raw);
    }
    default:
      return err(field, "unsupported", `Unsupported field type.`, raw);
  }
}
