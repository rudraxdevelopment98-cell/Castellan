# Castellan — Production-Readiness Audit

Audited branch: `audit/production-readiness` (from `claude/sharp-albattani-o0inem`, commit `22c623f`).
Method: read of `src/server/**`, `src/app/**` routes and actions, `schema.ts`, `rls.sql`, `db/client.ts`,
`next.config.mjs`, `.env.example`. Findings are verified against code, not docs.

Severities: **Critical** (data loss / cross-tenant or cross-scope exposure / auth bypass),
**High** (security or core-product failure a paying customer would hit), **Medium**, **Low**.

Legend for status: `OPEN` (not yet fixed), `FIXED <commit>`, `DECISION NEEDED`.

---

## Summary by severity

| Sev | Count | IDs |
| --- | --- | --- |
| Critical | 4 | C1, C2, C3, C4 |
| High | 13 | H1–H13 |
| Medium | 10 | M1–M10 |
| Low | 5 | L1–L5 |

_Counts are as first audited; findings discovered during the fix phase (C3, C4, M10) are added in place._

The tenant **cross-workspace** isolation model (Postgres RLS, `FORCE ROW LEVEL SECURITY`, fail-closed
`NULLIF(current_setting(...),'')::uuid`, non-superuser `app_user` role) is **sound** and well-implemented.
The Critical findings are about **within-workspace record scope** (teams / sub-users), which is the
acceptance test the brief singles out (a member on 50 properties must not reach the other 470).

---

## CRITICAL

### C1 — Record fetch/mutate ignore record scope (within-workspace IDOR) — FIXED `f6fdaae`
- **Area:** Authorisation / tenant scope
- **Files:** `src/server/records.ts:239` (`getRecord`), `:249` (`getRecordHistory`), `:144` (`updateRecord`), `:210` (`softDeleteRecord`), `:225` (`restoreRecord`); consumed by `src/app/(platform)/w/[slug]/o/[objectApiName]/[recordId]/page.tsx`.
- **What is wrong:** `getRecord` selects by `records.id` under `withWorkspace` only. RLS restricts to the
  workspace, but **record scope is not applied**. A member whose `memberships.scope_type = 'assigned'`
  (or `'team'`) can open, read the full history of, edit, soft-delete or restore **any** record in the
  workspace by putting its id in the URL / API body. `updateRecord`/`softDeleteRecord` check the
  capability (`records.edit/delete`) but never ownership, so an assigned-scope member with edit rights
  can mutate records they do not own.
- **Reproduce:** Create a workspace, add member B with `scope_type='assigned'`, assign B one record.
  As B, visit `/w/<slug>/o/<obj>/<id-of-a-record-owned-by-someone-else>` → the record renders.
  `PATCH /api/records` with that id → it updates.
- **Proposed fix:** Centralise a scope predicate (reuse the `assigned`/`team`/`filter` logic) and apply it
  in `getRecord`, `getRecordHistory`, `updateRecord`, `softDeleteRecord`, `restoreRecord`. A denied id
  must return the same "not found" as a non-existent id. Add isolation tests for each.

### C2 — Team / filter record scope unimplemented in the query layer — FIXED `f6fdaae` (fails closed; D1 open)
- **Area:** Authorisation / tenant scope
- **Files:** `src/server/records_query.ts:39`, `src/server/records.ts:279`.
- **What is wrong:** Only `scope_type = 'assigned'` is enforced (`ownerId = actor`). `'team'` and
  `'filter'` fall through and add **no** filter, so a member scoped to a team sees **every** record in the
  workspace across the grid, search, `count(*)`, CSV export, Today and record pages. This directly fails
  the brief's acceptance test (50 vs 470).
- **Reproduce:** Set a member's `scope_type='team'`; they see all records.
- **Proposed fix:** Implement team scope via `team_members`/record→team association in `buildWhere` and
  `listRecords`; until the association model is finalised, `'team'`/`'filter'` must **fail closed**
  (treat as `assigned` or empty) rather than open. Mark the association design `DECISION NEEDED`.

### C3 — Today / This-week ignore record scope — FIXED `992fe35`
- **Area:** Authorisation / tenant scope (found during the C1/C2 fix; same class)
- **Files:** `src/server/today.ts` (`loadOpen`, used by `buildTodayPlan` and `buildWeekPlan`).
- **What is wrong:** Open obligations were loaded for the whole workspace and joined to the record title,
  so a scope-restricted member saw the name, category and due date of every property's obligations, and
  the Today counts revealed the size of the portfolio outside their scope.
- **Reproduce:** As an `assigned`-scope member, open `/w/<slug>/today` — obligations for records owned by
  others are listed.
- **Fix:** `loadOpen` applies the same `recordScopeCondition` through the existing join on `records`.
  Covered by two cases in `test/record-scope.test.ts`.

### C4 — Sign-in is broken for every user — FIXED (C4 commit)
- **Area:** Authentication (found by the local end-to-end run during the fix phase)
- **Files:** `src/app/(auth)/actions.ts` (`signInAction`), `src/server/validation.ts` (`signInSchema`).
- **What is wrong:** The sign-in form renders no MFA field, so `formData.get("totp")` is `null`. The schema
  declares `totp` optional, which accepts `undefined` but not `null`, so validation failed and the action
  redirected to "Check your details." before the password was ever checked. Sign-up worked (it starts a
  session directly), so the fault only appeared when a user came back. The existing tests called
  `verifyLogin` directly and never exercised the form path.
- **Reproduce:** Sign up, sign out, sign in with the correct password -> "Check your details."
- **Fix:** Form fields are read through a helper that maps an absent field to `undefined`
  (`parseSignInForm`, `parseSignUpForm`). Covered by `test/auth-forms.test.ts` and verified end to end in a
  browser (sign up -> sign out -> sign in).

---

## HIGH

### H1 — `/api/chat` is unauthenticated, not tenant-scoped, and an open LLM proxy — FIXED (H1 commit): proxy closed; still answers from demo data only (a workspace-aware assistant is a feature, not built)
- **Files:** `src/app/api/chat/route.ts`.
- **What is wrong:** No session check. Anyone on the internet can POST. It answers from the in-memory
  **demo seed** (`getWorkspaceData(templateId)`), not the caller's workspace. If `ANTHROPIC_API_KEY` is
  set it forwards to Claude on every anonymous request — an open proxy that burns the key (cost / DoS).
- **Proposed fix:** Require an authenticated session + workspace membership; build context only from the
  caller's own workspace data; rate-limit; never run against seed data in production. If the assistant is
  to stay off by default, gate the route behind a flag and return 404 when disabled.

### H2 — CSV export does not check `records.export` — FIXED (H2 commit)
- **Files:** `src/app/api/export/route.ts`, `src/server/export.ts`.
- **What is wrong:** The route checks membership but never the `records.export` capability, and
  `exportCsv` has no guard. `member`, `viewer` and `guest` roles (which lack `records.export`) can export
  the whole object. Spec: member/viewer cannot export.
- **Proposed fix:** `requireCap(role, "records.export")` in the route (and/or in `exportCsv`). Add a
  role-by-route test.

### H3 — Invitations are not bound to the invited email — FIXED (H3/H4 commit)
- **Files:** `src/server/tenancy.ts:121` (`acceptInvite`).
- **What is wrong:** `acceptInvite` creates a membership for **whoever is logged in** when the token is
  presented; it never compares the authenticated user's email to `invitations.email`. An invite intended
  for `a@x.com` can be accepted by `b@y.com`; a leaked link grants workspace access to anyone.
- **Proposed fix:** Load the accepting user, compare normalised email to the invitation; reject on
  mismatch. Add tests for wrong-email, reused and expired tokens.

### H4 — Privilege escalation through invite role — FIXED (H3/H4 commit); role change / ownership transfer tracked in M7
- **Files:** `src/server/tenancy.ts:87` (`inviteMember`), `src/server/validation.ts` (invite role enum).
- **Correction after closer reading:** the invite *form* validates the role against a schema that excludes
  `owner`, so this was not exploitable through the shipped screen. The domain function, however, accepted
  any role from any caller with `members.manage`, so the guard lived in one UI path only.
- **What is wrong:** `inviteMember` accepted `owner` and never compared the invited role to the inviter's. There is also no transfer-ownership flow and no
  "last owner cannot be removed/demoted" guard.
- **Proposed fix:** Reject inviting/assigning a role higher than the actor's (only an owner may mint an
  owner); enforce ≥1 owner invariant anywhere role/membership changes.

### H5 — Email verification claimed but not implemented or enforced — OPEN
- **Files:** `src/server/users.ts:44`, `src/app/(auth)/actions.ts:43`.
- **What is wrong:** In production (`DATABASE_URL` set) new users get `emailVerifiedAt = null`, but
  sign-up immediately starts a session and nothing ever checks verification; there is no verification
  email and no verify route. The "verification gates workspace creation" comment is false.
- **Proposed fix:** Either implement real verification (token + email + `/verify` route, gate sensitive
  actions on it) or stop marking users unverified. Requires an email provider (see H9). `DECISION NEEDED`:
  verify-before-use vs verify-optional.

### H6 — Password reset is entirely missing — OPEN
- **Files:** none (no route/action/token type for reset).
- **What is wrong:** A user who forgets their password has no recovery path.
- **Proposed fix:** Add reset-request + reset-confirm with single-use, expiring, hashed tokens; invalidate
  other sessions on reset; uniform response regardless of whether the email exists. Needs email (H9).

### H7 — MFA is non-functional — OPEN
- **Files:** `src/app/(auth)/actions.ts:63`, `src/server/sessionStore.ts:41` (`resolveSession`).
- **What is wrong:** If `mfaEnabled`, sign-in dead-ends with "coming next" — a user who enables MFA can
  never sign in. There is no enrolment UI, and `resolveSession` ignores `sessions.mfaSatisfied`, so even
  a partially-authenticated session would be treated as fully authenticated.
- **Proposed fix:** Implement the TOTP step (prompt, verify, recovery codes), set `mfaSatisfied`, and treat
  a session as unauthenticated for sensitive routes until MFA is satisfied when the user/policy requires it.

### H8 — No security headers — FIXED (H8 commit): nonce-based CSP + static headers; fonts self-hosted
- **Files:** `next.config.mjs` (no `headers()`), no middleware.
- **What is wrong:** No Content-Security-Policy, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, or
  frame protection are sent.
- **Proposed fix:** Add a `headers()` block (or middleware) with a strict CSP, HSTS, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`.

### H9 — Notifications / daily brief delivery unimplemented — OPEN
- **Files:** none (no mailer, no scheduler, no delivery log).
- **What is wrong:** The product's promise ("every renewal becomes a daily task / brief") has no delivery
  mechanism. `.env.example` lists `RESEND_API_KEY`, Twilio, web-push, none wired.
- **Proposed fix:** Wire **email first** (provider + templated daily/weekly brief at the workspace's local
  time, once, with a delivery log and retry). Needs a provider key. `DECISION NEEDED`: provider + schedule host.

### H10 — No operator / platform-admin layer — OPEN / DECISION NEEDED
- **Files:** none (no platform route group, platform identity, support-access grant, or platform audit).
- **What is wrong:** Supporting or suspending a customer currently requires direct DB access, which the
  brief calls unacceptable. None of the platform roles, support-access grant, or platform audit log exist.
- **Proposed fix:** Build the minimal version from the brief (separate identity, own route group, MFA,
  time-boxed owner-approved read-only support grant, append-only platform audit). Large; scope and
  sequencing `DECISION NEEDED`.

### H11 — Login timing / message oracle enables email enumeration — FIXED (H11 commit); sign-up still reveals a taken email, tracked under H5 / D2
- **Files:** `src/server/users.ts:83`.
- **What is wrong:** When the email does not exist, `verifyLogin` returns immediately without an Argon2
  verify, so a missing account answers measurably faster than an existing one. A locked account returns a
  distinct "temporarily locked" message, also revealing existence.
- **Proposed fix:** Always perform a dummy Argon2 verify against a fixed hash when the user is missing;
  return the generic message for locked accounts too (or a generic "try later" that does not distinguish).

### H12 — Documents are not record-scope aware and have no capability checks — FIXED (H12 commit)
- **Files:** `src/server/documents.ts` (`listDocuments`, `getDocumentBytes`), `src/app/api/documents/[id]/route.ts`.
- **What is wrong:** Document listing/download are scoped only by workspace (RLS). A member with
  `assigned`/`team` scope can list every workspace document and download any by id, regardless of whether
  they may see the linked record. Same class as C1, for documents.
- **Proposed fix:** Apply the record-scope predicate to documents (via the linked `record_id` / owner);
  deny out-of-scope ids with "not found".

### H13 — Stored XSS through document upload — FIXED (H13 commit)
- **Area:** Input / output security (found while verifying the CSP in H8)
- **Files:** `src/app/api/documents/[id]/route.ts`, `src/server/documents.ts`.
- **What is wrong:** Uploads accepted any file and stored the browser-supplied `Content-Type`. The download
  route then served anything matching `text/*` or `image/*` **inline** from the application's own origin.
  An uploaded `.html` or `.svg` therefore executed script in the session of whoever opened it, with access
  to every same-origin endpoint. The filename was also reflected into `Content-Disposition` unsanitised.
- **Reproduce:** Upload `x.html` containing a script, open it from the Documents list -> script runs on the
  app origin.
- **Fix:** `src/server/uploads.ts` — extension allow-list; the stored type is taken from the file's magic
  bytes, never from the client; content that contradicts its extension is refused; only PDF and raster
  images render inline; everything else downloads as `application/octet-stream` under
  `Content-Security-Policy: default-src 'none'; sandbox`; `nosniff` on every response; filenames reduced to a
  plain name. A non-member now gets the same 404 as a missing document. Covered by `test/uploads.test.ts`
  and two integration cases in `test/documents.test.ts`.

---

## MEDIUM

### M1 — Session lifecycle gaps — OPEN
Absolute 12h expiry only; **no idle timeout**, **no rotation on sign-in or privilege change**, and no
"invalidate other sessions on password change" (no password-change flow exists). `src/server/session.ts`,
`src/server/sessionStore.ts`.

### M2 — No rate limiting on auth endpoints — OPEN
Only per-account lockout; no IP/endpoint throttle on sign-in, invite, (future) reset/MFA. A distributed
guess across many emails is unthrottled. `src/app/(auth)/actions.ts`.

### M3 — Workspace lifecycle states not enforced — OPEN
`workspaces.status` (`trial/active/past_due/suspended/scheduled_for_deletion/deleted`) is stored but no
request path enforces read-only (`past_due`) or blocks (`suspended`/`deleted`). `src/server/db/client.ts`
(`withWorkspace`), `src/server/tenancy.ts`.

### M4 — Public demo surface shipped in production — OPEN
The `(demo)` route group (`/records`, `/week`, `/compliance`, `/assistant`, `/ask`, `/settings`) is
unauthenticated and live in production, built on seed data. Confusing and an unnecessary surface.
`src/app/(demo)/**`.

### M5 — Error strings leaked by health/bootstrap — FIXED (migrations commit)
`/api/health` and `/api/bootstrap` return `String(e)` on failure, which can include DB host / DSN details.
`src/app/api/health/route.ts`, `src/app/api/bootstrap/route.ts`.

### M6 — `.env.example` inaccurate; no fail-fast on missing env — OPEN
Documents unused vars (`S3_*`, `TWILIO_*`, `OPEN_BANKING_*`, `LLM_*`, `AUTH_SECRET`) and omits the vars
actually used (`BOOTSTRAP_TOKEN`, `DB_LOCAL_ROLE`, `POSTGRES_URL*`). The app does not validate required
env at startup. `/.env.example`.

### M7 — Member management incomplete — OPEN
No change-role, remove-member, or revoke-invitation actions; the invite banner says "No email is sent in
local dev" even in production (email is never sent at all). `src/app/(platform)/w/[slug]/members/page.tsx`,
`src/app/(platform)/actions.ts`.

### M8 — Audit log has no viewer and partial coverage — OPEN
`audit_log` has a `prev_hash`/`hash` chain, but there is no owner/admin UI to view it, no verification of
the chain, and several actions (sign-in, export, role change) are not recorded. `src/server/audit.ts`.

### M9 — Metadata-driven filter field names not allow-listed — OPEN
`records_query.buildWhere` binds filter **values** as parameters (no SQLi), but field names come straight
from client input without an allow-list check against the object's fields (defense-in-depth).
`src/server/records_query.ts:45`.

### M10 — `npm run lint` cannot run — FIXED (lint gate commit)
There is no ESLint configuration and no `eslint` dependency, so `next lint` drops into an interactive
set-up prompt. The lint gate required by the audit brief is therefore not a gate at all. `package.json`.
Fix: add `eslint` + `eslint-config-next` with a flat config and a non-interactive `lint` script.

### M11 — Production migrations were not journaled or safely re-runnable — FIXED (migrations commit)
`bootstrap_prod.ts` applied all migrations only when the `workspaces` table was missing, and later schema
changes were hand-copied into an "ensure additions" block (the `documents` table existed twice, in the
migration and in that block). Nothing recorded which migrations had run, `rls.sql` failed if re-applied,
and a new tenant table would not be put under RLS on an existing database.
Fix: `src/server/db/migrate.ts` — one journaled runner (`castellan_migrations`) for production, dev and
tests; each migration applies once in its own transaction; pre-journal databases are baselined only when
everything a migration creates is present; `rls.sql` and `app_user` grants are idempotent and re-applied
every run. `test/migrations.test.ts`.

---

## LOW

- **L1** Recovery-code entropy is 40 bits (`randomBytes(5)`); raise to ≥64 bits. `src/server/auth.ts:66`.
- **L2** `react`/`react-dom` pinned to `18.3.1` while `useFormStatus` (a React 19 API) is used; it builds
  via Next's bundled React but the declared versions are inconsistent. `package.json`.
- **L3** Many routes lack explicit loading / empty / error / permission-denied states and a global error
  boundary. `src/app/**`.
- **L4** Inert / demo controls on non-core paths should be removed or clearly disabled. `src/app/(demo)/**`.
- **L5** Motion, responsiveness (360–1536px) and WCAG 2.2 AA have not been verified against
  `docs/DESIGN.md`; needs a dedicated pass.

---

## DECISION NEEDED

- **D1 (C2/H12):** The record→team association model for `'team'`/`'filter'` scope is not defined in code.
  Until decided, these scopes fail closed. Need the intended association (record.team_id? membership teams
  ∩ record teams?).
- **D2 (H5/H6/H9):** Email provider and whether verification is mandatory before workspace use. Needs a
  provider API key.
- **D3 (H10):** Scope and sequencing of the operator/platform-admin layer.

## What could not be verified
- Email, notification and any LLM-extraction behaviour — no provider keys configured in this environment.
- Live multi-user team scoping end-to-end — needs seeded multi-member workspaces (added in tests).
