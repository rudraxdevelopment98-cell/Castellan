import { and, eq, gt } from "drizzle-orm";
import {
  invitations,
  memberships,
  teams,
  users,
  workspaces,
} from "./db/schema";
import { asService, withWorkspace, type AnyPgDb } from "./db/client";
import { appendAudit } from "./audit";
import { newToken, sha256 } from "./auth";
import { requireCap, type Role } from "./rbac";

/**
 * Tenancy domain: workspaces, members, roles, teams, invitations. Every tenant
 * mutation runs inside `withWorkspace` (RLS-scoped) and checks the actor's role
 * with the RBAC guard; bootstrap and cross-workspace lookups use `asService`.
 */

// tx is the scoped drizzle transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function actorRole(tx: Tx, workspaceId: string, userId: string): Promise<Role> {
  const rows = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Actor is not a member of this workspace");
  return rows[0].role as Role;
}

export interface NewWorkspace {
  ownerUserId: string;
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
  defaultTemplate?: string;
}

/** Create a workspace and its Owner membership atomically (spec sign_up_flow). */
export async function createWorkspaceWithOwner(
  db: AnyPgDb,
  input: NewWorkspace,
): Promise<{ workspaceId: string }> {
  return asService(db, async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: input.name,
        slug: input.slug,
        timezone: input.timezone ?? "Europe/London",
        currency: input.currency ?? "GBP",
        defaultTemplate: input.defaultTemplate ?? null,
        status: "trial",
      })
      .returning({ id: workspaces.id });
    await tx.insert(memberships).values({
      workspaceId: ws.id,
      userId: input.ownerUserId,
      role: "owner",
      scopeType: "all",
    });
    await appendAudit(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerUserId,
      action: "workspace.created",
      entity: "workspace",
      entityId: ws.id,
      after: { name: input.name, slug: input.slug },
    });
    return { workspaceId: ws.id };
  });
}

export interface InviteInput {
  workspaceId: string;
  actorUserId: string;
  email: string;
  role: Role;
  teamIds?: string[];
}

/** Invite a member with a role; returns the raw token (shown once). */
export async function inviteMember(
  db: AnyPgDb,
  input: InviteInput,
): Promise<{ invitationId: string; token: string }> {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRole(tx, input.workspaceId, input.actorUserId), "members.manage");
    const { token, tokenHash } = newToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const [inv] = await tx
      .insert(invitations)
      .values({
        workspaceId: input.workspaceId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        teamIds: input.teamIds ?? null,
        tokenHash,
        status: "pending",
        invitedByUserId: input.actorUserId,
        expiresAt,
      })
      .returning({ id: invitations.id });
    await appendAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "member.invited",
      entity: "invitation",
      entityId: inv.id,
      after: { email: input.email, role: input.role },
    });
    return { invitationId: inv.id, token };
  });
}

/** Accept an invite: creates the membership with the invited role. */
export async function acceptInvite(
  db: AnyPgDb,
  input: { token: string; userId: string },
): Promise<{ workspaceId: string; role: Role }> {
  const tokenHash = sha256(input.token);
  // Cross-workspace lookup by token -> service path, then scoped writes.
  return asService(db, async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, tokenHash), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (!inv) throw new Error("Invitation is invalid or has expired");
    await tx
      .insert(memberships)
      .values({ workspaceId: inv.workspaceId, userId: input.userId, role: inv.role, scopeType: "all" })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, inv.id));
    await appendAudit(tx, {
      workspaceId: inv.workspaceId,
      actorUserId: input.userId,
      action: "member.joined",
      entity: "membership",
      entityId: input.userId,
      after: { role: inv.role },
    });
    return { workspaceId: inv.workspaceId as string, role: inv.role as Role };
  });
}

export async function createTeam(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; name: string },
): Promise<{ teamId: string }> {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRole(tx, input.workspaceId, input.actorUserId), "members.manage");
    const [team] = await tx
      .insert(teams)
      .values({ workspaceId: input.workspaceId, name: input.name })
      .returning({ id: teams.id });
    await appendAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "team.created",
      entity: "team",
      entityId: team.id,
      after: { name: input.name },
    });
    return { teamId: team.id };
  });
}

/** List members of a workspace (RLS guarantees only this workspace's rows). */
export async function listMembers(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string },
) {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    return tx
      .select({
        userId: memberships.userId,
        role: memberships.role,
        email: users.email,
        name: users.name,
      })
      .from(memberships)
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, input.workspaceId));
  });
}
