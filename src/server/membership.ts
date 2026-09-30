import { and, eq } from "drizzle-orm";
import { memberships } from "./db/schema";
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
