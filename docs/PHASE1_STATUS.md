# Phase 1 — Foundations: status

Per the v2.0 delivery plan. Exit criterion: **two workspaces fully isolated in
automated tests; owner can invite a member with a role.** ✅ Met.

## Built

- **Schema** (`src/server/db/schema.ts`, Drizzle → `drizzle/0000_phase1_tenancy.sql`):
  users, sessions (global); workspaces, teams, memberships, team_members,
  invitations, audit_log (tenant-scoped). Every tenant table has
  `workspace_id NOT NULL`, indexed, and in its unique constraints.
- **Row-level security** (`src/server/db/rls.sql`): `app.workspace_id` GUC set per
  transaction; `FORCE ROW LEVEL SECURITY` on every tenant table; `NULLIF(...)::uuid`
  so unset scope fails closed; `app.bypass` service path for auth/bootstrap/jobs.
- **Query layer** (`src/server/db/client.ts`): `withWorkspace()` and `asService()`
  are the only ways in; scope is enforced in the database, not just the app.
- **Auth primitives** (`src/server/auth.ts`): Argon2id hashing, opaque
  session/invite tokens stored only as SHA-256, TOTP MFA, recovery codes,
  lockout constants.
- **RBAC** (`src/server/rbac.ts`): system roles (owner/admin/manager/member/
  viewer/guest) with capability sets and a throwing guard.
- **Tenancy domain** (`src/server/tenancy.ts`): create workspace + owner, invite
  member with role, accept invite, create team, list members — all scoped and
  permission-checked.
- **Audit** (`src/server/audit.ts`): append-only, per-workspace SHA-256 hash chain
  with a verifier.
- **Isolation test suite** (`test/isolation.test.ts`, 9 tests, PGlite): proves a
  member of A sees zero rows from B on select, explicit cross-tenant query,
  cross-tenant insert (WITH CHECK), fail-closed with no scope, audit non-leakage
  + chain integrity, and the invite→accept→role acceptance test.

**Tests:** 41 passing (32 rules engine + 9 isolation). Typecheck clean. App builds.

## How to run

```bash
npm install
npm run db:generate      # regenerate migrations if schema changes
npm test                 # includes the isolation suite (uses in-process PGlite)
```

Production points `DATABASE_URL` at Supabase Postgres; the same migrations +
`rls.sql` apply there. On Supabase the app connects as a non-superuser, so RLS
applies without the test harness's `DB_LOCAL_ROLE` shim.

## Stubbed / not yet wired (Phase 1 remainder + later phases)

- **UI**: sign-up / workspace-create / members screens and route handlers. The
  domain + DB layer (the exit criterion) is done and tested; the screens sit on
  top of it and are next.
- **Session middleware**: cookie issue/verify and the request→membership→workspace
  resolver that calls `withWorkspace`. Primitives exist (`src/server/auth.ts`).
- **OAuth / passkeys**: TOTP is implemented; Google/Microsoft SSO and passkeys are
  documented follow-ups.
- **Supabase project**: not provisioned — needs your Supabase `DATABASE_URL`
  (and service key) to run migrations and host data. Everything is verified
  locally against PGlite until then.
- **Platform admin console**: not started (Phase 1 "basic" item; deferred to the
  UI pass).
- The **v1 demo app** (in-memory) still lives in `src/app` + `src/lib`; it will be
  re-based onto this engine in Phase 3.

## Open risks

1. **Supabase role setup**: production must connect as a non-superuser role that
   is subject to RLS (not the service role) for tenant traffic; the service role
   (BYPASSRLS) is only for auth/bootstrap/jobs. Must be verified on the real
   project before any customer data.
2. **GUC scoping under pooling**: `set_config(..., is_local=true)` requires the
   transaction and its queries to share one connection. With PgBouncer in
   transaction mode this holds; statement mode would break it — pin the pooler
   mode when wiring Supabase.
3. **No live end-to-end auth yet**: email verification, OAuth and passkeys need
   the deployed environment to test fully.
