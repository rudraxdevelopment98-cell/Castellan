import type { AnyPgDb } from "./db/client";
import { queryRecords, type RecordFilter } from "./records_query";
import { toCsv } from "./csv";
import type { FieldDefLite } from "./pipeline/fieldtypes";

/**
 * Export the current view to CSV (spec import_export.export): respects filters,
 * columns and the caller's record scope. Money is rendered as a decimal amount;
 * booleans as Yes/No; multi-values joined.
 */

function cell(value: unknown, field?: FieldDefLite): string {
  if (value === null || value === undefined) return "";
  if (field?.type === "currency" && typeof value === "number") return (value / 100).toFixed(2);
  if (field?.type === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function exportCsv(
  db: AnyPgDb,
  cmd: {
    workspaceId: string;
    actorUserId: string;
    objectId: string;
    fields: FieldDefLite[];
    search?: string;
    filters?: RecordFilter[];
    max?: number;
  },
): Promise<string> {
  const max = cmd.max ?? 10000;
  const headers = ["Record #", "Title", ...cmd.fields.map((f) => f.label)];
  const outRows: unknown[][] = [];
  let cursor: { updatedAt: string; id: string } | null = null;

  while (outRows.length < max) {
    const page: Awaited<ReturnType<typeof queryRecords>> = await queryRecords(db, {
      workspaceId: cmd.workspaceId,
      actorUserId: cmd.actorUserId,
      objectId: cmd.objectId,
      search: cmd.search,
      filters: cmd.filters,
      cursor,
      limit: 250,
    });
    for (const r of page.rows) {
      outRows.push([
        r.recordNumber ?? "",
        r.title ?? "",
        ...cmd.fields.map((f) => cell(r.data[f.apiName], f)),
      ]);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return toCsv(headers, outRows);
}
