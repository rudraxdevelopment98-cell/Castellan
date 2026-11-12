import { and, eq } from "drizzle-orm";
import { memberships, records } from "./db/schema";
import type { Role } from "./rbac";

// tx is the scoped drizzle transaction from withWorkspace.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function actorRoleInTx(tx: any, workspaceId: string, userId: string): Promise<Role> {
  const rows = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Actor is not a member of this workspace");
  return rows[0].role as Role;
}

export interface ActorContext {
  role: Role;
  scopeType: string; // all | team | assigned | filter
}

/** Load the actor's role AND record scope in one query. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function actorContextInTx(tx: any, workspaceId: string, userId: string): Promise<ActorContext> {
  const rows = await tx
    .select({ role: memberships.role, scopeType: memberships.scopeType })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Actor is not a member of this workspace");
  return { role: rows[0].role as Role, scopeType: (rows[0].scopeType as string) ?? "all" };
}

/**
 * The record-scope predicate for a member (spec record_scope). Only 'all' sees
 * every record in the workspace. Every other scope is restricted to the actor's
 * own records: 'assigned' is own-records by definition, and 'team'/'filter' —
 * whose record→team association is not yet modelled (AUDIT D1) — FAIL CLOSED to
 * the same safe subset rather than leaking the whole workspace. Returns a
 * Drizzle condition to AND into a query, or null for no restriction.
 */
export function recordScopeCondition(scopeType: string, actorUserId: string) {
  return scopeType === "all" ? null : eq(records.ownerId, actorUserId);
}

/** True when the actor's scope allows them to see a record with this ownerId. */
export function recordInScope(scopeType: string, actorUserId: string, ownerId: string | null): boolean {
  return scopeType === "all" || ownerId === actorUserId;
}
