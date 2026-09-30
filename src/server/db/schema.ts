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

// ---------------------------------------------------------------------------
// Phase 2 — metadata engine: objects, fields, records, links, history, outbox.
// Customers define their own data model at runtime; records store typed values
// in a jsonb `data` column (spec metadata_engine.storage_design, the hybrid).
// ---------------------------------------------------------------------------

export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "long_text",
  "number",
  "currency",
  "percent",
  "date",
  "datetime",
  "duration",
  "boolean",
  "single_select",
  "multi_select",
  "status",
  "email",
  "phone",
  "url",
  "address",
  "person",
  "relation",
  "file",
  "sensitive_text",
  "auto_number",
]);

export const objectDefs = pgTable(
  "object_defs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    apiName: text("api_name").notNull(), // immutable after creation
    singularLabel: text("singular_label").notNull(),
    pluralLabel: text("plural_label").notNull(),
    icon: text("icon"),
    titleFieldApiName: text("title_field_api_name"),
    description: text("description"),
    numberingPrefix: text("numbering_prefix"),
    numberingSeq: integer("numbering_seq").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    apiNameUnique: uniqueIndex("object_defs_ws_api_unique").on(t.workspaceId, t.apiName),
    byWs: index("object_defs_ws_idx").on(t.workspaceId),
  }),
);

export const fieldDefs = pgTable(
  "field_defs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    objectId: uuid("object_id").notNull().references(() => objectDefs.id, { onDelete: "cascade" }),
    apiName: text("api_name").notNull(), // immutable after creation
    label: text("label").notNull(),
    type: fieldTypeEnum("type").notNull(),
    helpText: text("help_text"),
    config: jsonb("config").$type<Record<string, unknown>>(), // per-type options
    required: boolean("required").notNull().default(false),
    unique: boolean("unique").notNull().default(false),
    filterable: boolean("filterable").notNull().default(false),
    defaultValue: jsonb("default_value"),
    section: text("section"),
    position: integer("position").notNull().default(0),
    permissions: jsonb("permissions"), // per-role field visibility overrides
    isSystem: boolean("is_system").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    apiNameUnique: uniqueIndex("field_defs_obj_api_unique").on(t.workspaceId, t.objectId, t.apiName),
    byObject: index("field_defs_object_idx").on(t.workspaceId, t.objectId),
  }),
);

export const records = pgTable(
  "records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    objectId: uuid("object_id").notNull().references(() => objectDefs.id, { onDelete: "cascade" }),
    title: text("title"),
    status: text("status"),
    recordNumber: text("record_number"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    isSample: boolean("is_sample").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1), // optimistic locking
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete / bin
  },
  (t) => ({
    byObject: index("records_object_idx").on(t.workspaceId, t.objectId),
    byDeleted: index("records_deleted_idx").on(t.workspaceId, t.deletedAt),
  }),
);

export const recordLinks = pgTable(
  "record_links",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    fromRecordId: uuid("from_record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
    fieldApiName: text("field_api_name").notNull(),
    toRecordId: uuid("to_record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromRecordId, t.fieldApiName, t.toRecordId] }),
    byWs: index("record_links_ws_idx").on(t.workspaceId),
    byTo: index("record_links_to_idx").on(t.workspaceId, t.toRecordId),
  }),
);

export const recordHistory = pgTable(
  "record_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    field: text("field").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    source: text("source").notNull().default("ui"), // ui | import | api | rule
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRecord: index("record_history_record_idx").on(t.workspaceId, t.recordId),
  }),
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // record.created | record.updated | record.deleted | ...
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    unprocessed: index("outbox_unprocessed_idx").on(t.workspaceId, t.processedAt),
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
  "object_defs",
  "field_defs",
  "records",
  "record_links",
  "record_history",
  "outbox",
] as const;
