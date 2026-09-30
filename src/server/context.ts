import { and, eq } from "drizzle-orm";
import { memberships, workspaces } from "./db/schema";
import { asService, getDb } from "./db/client";
import type { Role } from "./rbac";

/**
 * Membership resolution. A user's set of workspaces spans tenants, so these
 * lookups use the service path and filter by the user's own id. The result then
 * tells request handlers which workspace to open with `withWorkspace`.
 */

export interface WorkspaceMembership {
  workspaceId: string;
  slug: string;
  name: string;
  role: Role;
}

export async function getMembershipsForUser(userId: string): Promise<WorkspaceMembership[]> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const rows = await tx
      .select({
        workspaceId: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId));
    return rows.map((r: { workspaceId: string; slug: string; name: string; role: string }) => ({
      workspaceId: r.workspaceId,
      slug: r.slug,
      name: r.name,
      role: r.role as Role,
    }));
  });
}

/** Verify the user belongs to the workspace with this slug; return membership. */
export async function resolveWorkspaceForUser(
  userId: string,
  slug: string,
): Promise<WorkspaceMembership | null> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [row] = await tx
      .select({
        workspaceId: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, userId), eq(workspaces.slug, slug)))
      .limit(1);
    if (!row) return null;
    return {
      workspaceId: row.workspaceId as string,
      slug: row.slug as string,
      name: row.name as string,
      role: row.role as Role,
    };
  });
}

/** Ensure a slug is unique by suffixing -2, -3, … when taken. */
export async function uniqueWorkspaceSlug(seed: string): Promise<string> {
  const db = await getDb();
  return asService(db, async (tx) => {
    let candidate = seed;
    for (let i = 2; i < 1000; i++) {
      const [hit] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, candidate))
        .limit(1);
      if (!hit) return candidate;
      candidate = `${seed}-${i}`;
    }
    return `${seed}-${Date.now()}`;
  });
}
