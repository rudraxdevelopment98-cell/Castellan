import { formatUkDate } from "./rules/dates";

/** Pure display formatting for a stored field value, shared by grid + detail. */
export interface DisplayField {
  apiName: string;
  label: string;
  type: string;
  config?: Record<string, unknown> | null;
}

export function formatFieldValue(value: unknown, field: DisplayField, currency = "GBP"): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "currency":
      return typeof value === "number"
        ? `${currency} ${(value / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
        : String(value);
    case "percent":
      return `${value}%`;
    case "boolean":
      return value ? "Yes" : "No";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatUkDate(value) : String(value);
    case "datetime":
      try { return new Date(String(value)).toLocaleString("en-GB"); } catch { return String(value); }
    case "single_select":
    case "status": {
      const opts = (field.config?.options as { id: string; label?: string }[] | undefined) ?? [];
      const o = opts.find((x) => x.id === value);
      return o?.label ?? String(value);
    }
    case "multi_select": {
      const opts = (field.config?.options as { id: string; label?: string }[] | undefined) ?? [];
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => opts.find((x) => x.id === v)?.label ?? String(v)).join(", ");
    }
    case "sensitive_text":
      return "•••• (hidden)";
    case "address": {
      if (typeof value === "object" && value !== null) {
        const a = value as Record<string, unknown>;
        return [a.line1, a.postcode].filter(Boolean).join(", ") || JSON.stringify(a);
      }
      return String(value);
    }
    case "file":
      return Array.isArray(value) ? `${value.length} file(s)` : String(value);
    default:
      return String(value);
  }
}
