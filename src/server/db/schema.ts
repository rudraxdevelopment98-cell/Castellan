import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Castellan v2.0 — Phase 1 schema: tenancy, auth, audit.
 *
 * Tenant isolation rule (spec tenancy_model.isolation_must): every tenant-owned
 * table has `workspace_id NOT NULL`, indexed, and part of its unique constraints.
 * Row-level security policies (see rls.sql) filter every tenant table on the
 * `app.workspace_id` GUC that the query layer sets per transaction.
 *
 * Global tables (users, sessions) are NOT tenant-scoped and are only ever
 * reached through the auth layer, never the tenant-scoped query path.
 */

export const roleEnum = pgEnum("role", [
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
  "guest",
]);

export const workspaceStatusEnum = pgEnum("workspace_status", [
  "trial",
  "active",
  "past_due",
  "suspended",
  "scheduled_for_deletion",
  "deleted",
]);

export const scopeTypeEnum = pgEnum("scope_type", [
  "all", // every record in the workspace
  "team", // records owned by the member's team(s)
  "assigned", // records assigned to the member
  "filter", // records matching a saved filter (jsonb)
]);

export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

// --- Global (not tenant-scoped) --------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // Argon2id hash (spec authentication_must). Null when the user only has SSO.
    passwordHash: text("password_hash"),
    name: text("name"),
    // TOTP secret (encrypted at the app layer before storage in prod).
    totpSecret: text("totp_secret"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    recoveryCodes: jsonb("recovery_codes").$type<string[]>(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Only the SHA-256 of the session token is stored; the raw token is a cookie.
    tokenHash: text("token_hash").notNull(),
    // Elevated after MFA; privilege changes rotate the session (spec).
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    tokenUnique: uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    byUser: index("sessions_user_idx").on(t.userId),
  }),
);

// --- Tenant-scoped (RLS enforced) ------------------------------------------

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoKey: text("logo_key"),
    brandAccent: text("brand_accent"),
    locale: text("locale").notNull().default("en-GB"),
    timezone: text("timezone").notNull().default("Europe/London"),
    currency: text("currency").notNull().default("GBP"),
    dateFormat: text("date_format").notNull().default("d MMM yyyy"),
    weekStart: integer("week_start").notNull().default(1), // Monday
    dataRegion: text("data_region").notNull().default("eu-west-2"),
    defaultTemplate: text("default_template"),
    status: workspaceStatusEnum("status").notNull().default("trial"),
    securityPolicy: jsonb("security_policy").$type<{
      mfaRequired?: boolean;
      sessionMaxHours?: number;
      ipAllowlist?: string[];
    }>(),
    scheduledDeletionAt: timestamp("scheduled_deletion_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("workspaces_slug_unique").on(t.slug),
  }),
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // workspace_id is part of the unique constraint (isolation rule).
    nameUnique: uniqueIndex("teams_ws_name_unique").on(t.workspaceId, t.name),
    byWs: index("teams_ws_idx").on(t.workspaceId),
  }),
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    // Record-scope for this member (enforced in the query layer, spec record_scope).
    scopeType: scopeTypeEnum("scope_type").notNull().default("all"),
    scopeFilter: jsonb("scope_filter"),
    // Custom per-object permission overrides (cloned/edited role), spec custom_roles.
    permissionOverrides: jsonb("permission_overrides"),
    guestExpiresAt: timestamp("guest_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsUserUnique: uniqueIndex("memberships_ws_user_unique").on(t.workspaceId, t.userId),
    byWs: index("memberships_ws_idx").on(t.workspaceId),
    byUser: index("memberships_user_idx").on(t.userId),
  }),
);

export const teamMembers = pgTable(
  "team_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.userId] }),
    byWs: index("team_members_ws_idx").on(t.workspaceId),
  }),
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("member"),
    teamIds: jsonb("team_ids").$type<string[]>(),
    tokenHash: text("token_hash").notNull(),
    status: inviteStatusEnum("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One pending invite per email per workspace.
    wsEmailUnique: uniqueIndex("invitations_ws_email_unique").on(t.workspaceId, t.email),
    tokenUnique: uniqueIndex("invitations_token_hash_unique").on(t.tokenHash),
    byWs: index("invitations_ws_idx").on(t.workspaceId),
  }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable for platform/global auth events; set for tenant events.
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    // Append-only hash chain (spec security_and_compliance): each row's hash
    // covers its content plus the previous row's hash for the same workspace.
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWs: index("audit_ws_idx").on(t.workspaceId),
    byActor: index("audit_actor_idx").on(t.actorUserId),
    byAt: index("audit_at_idx").on(t.at),
  }),
);

/** Tenant tables that RLS must FORCE. Kept here so rls.sql and tests agree. */
export const TENANT_TABLES = [
  "workspaces",
  "teams",
  "memberships",
  "team_members",
  "invitations",
  "audit_log",
] as const;
