/**
 * Role-based access control (spec accounts_and_access.roles).
 *
 * System roles carry default capabilities. Admins can clone a role and toggle
 * per-object permissions (permissionOverrides on the membership); Phase 2 adds
 * the per-object/field matrix. Phase 1 enforces the coarse capabilities below,
 * which gate structural and membership actions.
 */

export type Role = "owner" | "admin" | "manager" | "member" | "viewer" | "guest";

export type Capability =
  | "workspace.manage" // settings, branding, security policy
  | "workspace.delete"
  | "billing.manage"
  | "members.manage" // invite, remove, set roles, teams
  | "structure.manage" // objects, fields, rules, templates
  | "records.create"
  | "records.edit"
  | "records.delete"
  | "records.export"
  | "records.view";

const R = (...caps: Capability[]) => new Set<Capability>(caps);

const ALL: Capability[] = [
  "workspace.manage",
  "workspace.delete",
  "billing.manage",
  "members.manage",
  "structure.manage",
  "records.create",
  "records.edit",
  "records.delete",
  "records.export",
  "records.view",
];

export const ROLE_CAPABILITIES: Record<Role, Set<Capability>> = {
  owner: R(...ALL),
  admin: R(
    "workspace.manage",
    "members.manage",
    "structure.manage",
    "records.create",
    "records.edit",
    "records.delete",
    "records.export",
    "records.view",
  ),
  manager: R("records.create", "records.edit", "records.export", "records.view"),
  member: R("records.create", "records.edit", "records.view"),
  viewer: R("records.view"),
  guest: R("records.view"),
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

/** Throwing guard for use in domain functions. */
export class PermissionError extends Error {
  constructor(public capability: Capability) {
    super(`Missing permission: ${capability}`);
    this.name = "PermissionError";
  }
}

export function requireCap(role: Role, capability: Capability): void {
  if (!can(role, capability)) throw new PermissionError(capability);
}
