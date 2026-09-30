import { and, desc, eq, isNull } from "drizzle-orm";
import { auditLog } from "./db/schema";
import { sha256 } from "./auth";

/**
 * Append-only audit log with a per-workspace hash chain (spec
 * security_and_compliance). Each row's hash covers its content plus the previous
 * row's hash, so any tampering with history is detectable. Never updated or
 * deleted in normal operation.
 */

export interface AuditEntry {
  workspaceId: string | null;
  actorUserId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

function canonical(entry: AuditEntry, prevHash: string | null, at: string): string {
  return JSON.stringify([
    entry.workspaceId,
    entry.actorUserId ?? null,
    entry.action,
    entry.entity ?? null,
    entry.entityId ?? null,
    entry.before ?? null,
    entry.after ?? null,
    prevHash,
    at,
  ]);
}

// tx is the scoped drizzle transaction from withWorkspace / asService.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function appendAudit(tx: any, entry: AuditEntry): Promise<void> {
  const whereWs = entry.workspaceId
    ? eq(auditLog.workspaceId, entry.workspaceId)
    : isNull(auditLog.workspaceId);
  const prev = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .where(and(whereWs))
    .orderBy(desc(auditLog.at))
    .limit(1);
  const prevHash: string | null = prev[0]?.hash ?? null;
  const at = new Date().toISOString();
  const hash = sha256(canonical(entry, prevHash, at));
  await tx.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    prevHash,
    hash,
    // Pin `at` to the value the hash was computed over (don't let the DB default
    // set a different timestamp, or the chain would fail verification).
    at: new Date(at),
  });
}

/** Verify a workspace's audit chain is intact (for tests / integrity checks). */
export function verifyChain(
  rows: { action: string; hash: string; prevHash: string | null; at: Date | string;
    workspaceId: string | null; actorUserId: string | null; entity: string | null;
    entityId: string | null; before: unknown; after: unknown }[],
): boolean {
  let prev: string | null = null;
  for (const r of rows) {
    const at = typeof r.at === "string" ? r.at : r.at.toISOString();
    const expected = sha256(
      canonical(
        {
          workspaceId: r.workspaceId,
          actorUserId: r.actorUserId,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          before: r.before,
          after: r.after,
        },
        prev,
        at,
      ),
    );
    if (expected !== r.hash || r.prevHash !== prev) return false;
    prev = r.hash;
  }
  return true;
}
