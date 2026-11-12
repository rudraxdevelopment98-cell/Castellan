import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { records } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { actorContextInTx, recordScopeCondition } from "./membership";

/**
 * Paginated record queries for the data grid. Keyset pagination on
 * (updated_at, id) — never offset — so it stays fast at 100k+ rows (spec
 * data_grid.pagination). Search hits the title + data; simple field filters map
 * to jsonb lookups. Record scope ('assigned') is enforced here in the query.
 */

export interface RecordFilter {
  field: string;
  op: "eq" | "neq" | "contains";
  value: string;
}

export interface QueryParams {
  workspaceId: string;
  actorUserId: string;
  objectId: string;
  search?: string;
  filters?: RecordFilter[];
  limit?: number;
  cursor?: { updatedAt: string; id: string } | null;
  includeDeleted?: boolean;
}

export interface QueryResult {
  rows: Array<{ id: string; title: string | null; recordNumber: string | null; data: Record<string, unknown>; updatedAt: Date; isSample: boolean }>;
  nextCursor: { updatedAt: string; id: string } | null;
  total: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildWhere(records_: typeof records, p: QueryParams, me: { scopeType: string }) {
  const w = [eq(records_.workspaceId, p.workspaceId), eq(records_.objectId, p.objectId)];
  w.push(p.includeDeleted ? isNotNull(records_.deletedAt) : isNull(records_.deletedAt));
  // Only 'all' sees every record; every other scope is restricted to own
  // records (fail closed — 'team'/'filter' association is not yet modelled).
  const scope = recordScopeCondition(me.scopeType, p.actorUserId);
  if (scope) w.push(scope);

  if (p.search && p.search.trim()) {
    const like = `%${p.search.trim()}%`;
    w.push(sql`(coalesce(${records_.title}, '') ilike ${like} or ${records_.data}::text ilike ${like})`);
  }
  for (const f of p.filters ?? []) {
    const col = sql`(${records_.data} ->> ${f.field})`;
    if (f.op === "eq") w.push(sql`${col} = ${f.value}`);
    else if (f.op === "neq") w.push(sql`${col} is distinct from ${f.value}`);
    else w.push(sql`${col} ilike ${`%${f.value}%`}`);
  }
  return w;
}

export async function queryRecords(db: AnyPgDb, p: QueryParams): Promise<QueryResult> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 250);
  return withWorkspace(db, { workspaceId: p.workspaceId, userId: p.actorUserId }, async (tx) => {
    const me = await actorContextInTx(tx, p.workspaceId, p.actorUserId);

    const where = buildWhere(records, p, { scopeType: me.scopeType });

    const pageWhere = [...where];
    if (p.cursor) {
      // Keyset: strictly "after" the cursor in (updated_at desc, id desc) order.
      pageWhere.push(sql`(${records.updatedAt}, ${records.id}) < (${new Date(p.cursor.updatedAt)}, ${p.cursor.id})`);
    }

    const rows = await tx
      .select({
        id: records.id,
        title: records.title,
        recordNumber: records.recordNumber,
        data: records.data,
        updatedAt: records.updatedAt,
        isSample: records.isSample,
      })
      .from(records)
      .where(and(...pageWhere))
      .orderBy(sql`${records.updatedAt} desc, ${records.id} desc`)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? { updatedAt: new Date(last.updatedAt).toISOString(), id: last.id as string } : null;

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(records)
      .where(and(...where));

    return { rows: page as QueryResult["rows"], nextCursor, total: Number(count) };
  });
}
