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

- **UI + session middleware** (added): sign-up / sign-in / sign-out, workspace
  onboarding (with template choice), workspace shell (`/w/[slug]`) with a
  workspace switcher and route guard, members list + invite form + pending
  invitations, and the invite-accept flow (`/invite/[token]`). Session is an
  httpOnly cookie holding an opaque token whose SHA-256 is stored; `requireUser`
  guards protected routes and redirects with a `next` return path. The v1 demo
  screens moved under a `(demo)` route group with their own shell.
- **Local dev database**: a file-backed PGlite (same migrations + rls.sql as
  Supabase) so the whole platform runs with `npm run dev` and no external DB;
  `getDb()` uses Supabase when `DATABASE_URL` is set. `/api/health` reports DB
  connectivity.
- **auth-flow integration test** (`test/auth-flow.test.ts`, 5 tests): sign up,
  duplicate-email rejection, lockout, session create/resolve/revoke, workspace
  onboarding, invite→accept with role, unique-slug collisions.

**Tests:** 46 passing (32 rules engine + 9 isolation + 5 auth-flow). Typecheck
clean. App builds. The full sign-up → workspace → invite → accept flow was also
verified end-to-end in a real browser (Playwright); screenshots in
`docs/screenshots/v2-*.png`.

**Verified bug fixes during the UI build:** a `redirect()` inside a try/catch was
swallowing `NEXT_REDIRECT` (invite accept now redirects outside the try); and
`next start` forks multiple workers, which a file-backed PGlite can't share — use
`npm run dev` locally (Supabase is shared, so production is unaffected).

## How to run

```bash
npm install
npm run db:generate      # regenerate migrations if schema changes
npm test                 # includes the isolation suite (uses in-process PGlite)
```

Production points `DATABASE_URL` at Supabase Postgres; the same migrations +
`rls.sql` apply there. On Supabase the app connects as a non-superuser, so RLS
applies without the test harness's `DB_LOCAL_ROLE` shim.

## Stubbed / not yet wired (later phases)

- **OAuth / passkeys**: TOTP is implemented; the MFA enrolment + TOTP sign-in
  screens, Google/Microsoft SSO and passkeys are documented follow-ups.
- **Email delivery**: invites surface a copyable link in local dev; production
  wiring (Resend/Postmark) for verification + invite emails is pending.
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
