# Castellan: end-to-end audit, fix and production-readiness pass

You are working in the Castellan repository. Castellan is a multi-tenant SaaS that reads documents, extracts dated facts, runs them through a rules engine, and produces dated obligations plus a daily brief. The flagship customer is a UK landlord with 500+ properties, so a wrong date, a missed reminder, or one tenant seeing another tenant's data is a business-ending failure. Treat correctness and isolation as more important than new features.

Your job is to go through the whole product, find what is broken, insecure, half-wired or inconsistent, fix it, and leave the app in a state where a real paying customer can be onboarded. Do not add new product features in this pass (no billing, no referrals). If something needed for those is missing, note it in the report.

## How to work

1. **Read before you change anything.** Read `README.md`, everything in `docs/` (especially `ARCHITECTURE.md`, `DESIGN.md` and the `*_STATUS.md` files), `package.json`, the database schema, the RLS SQL, and every file under `src/server`. The docs may be out of date; where code and docs disagree, the code is the truth and the doc gets corrected.
2. **Create a branch** called `audit/production-readiness`. Never commit to the main branch.
3. **Audit first, fix second.** Write every finding to `docs/AUDIT.md` before fixing: ID, area, severity (Critical / High / Medium / Low), file and line, what is wrong, how to reproduce, proposed fix. Then fix in severity order.
4. **One logical fix per commit**, with the finding ID in the message. Every Critical or High fix gets a test that fails before the fix and passes after.
5. **Keep it green.** After each group of fixes run `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build`. Do not move on while any of them fail.
6. **Do not guess silently.** If a product decision is unclear, pick the safer option, mark it `DECISION NEEDED` in `docs/AUDIT.md`, and carry on.
7. **Never weaken a control to make a test pass**, never delete a failing test, never hard-code secrets, and never log passwords, tokens, session IDs or document contents.

## Roles to verify

The intended hierarchy is below. Check what the code really implements, map it to this, and close the gaps.

| Level | Who | Can do |
| --- | --- | --- |
| Platform staff | The Castellan operator and their team | Run the platform, not the customer's workspace. See "Operator team" below. |
| Owner | The customer who created the workspace | Everything in their workspace, including delete workspace, transfer ownership and manage billing. |
| Admin | Trusted staff | Settings, members, teams, structure (objects, fields, rules), all records. No billing, no workspace delete. |
| Manager | Team lead | Create, edit, export records within their teams' scope. |
| Member ("sub user") | Staff | Create and edit records they are scoped to. No export, no delete. |
| Viewer / Guest | Read-only | View only what they are scoped to. Guests see only records explicitly shared with them. |

### Operator team (Castellan's own staff)

The operator is not one person. Platform staff sit outside every customer workspace and have their own roles. Check whether a platform layer exists; if it does not, build the minimal version below, because without it the only way to support a customer is direct database access, which is unacceptable.

| Platform role | Can do | Cannot do |
| --- | --- | --- |
| Platform owner ("main admin") | Everything below, plus add, remove and change roles of platform staff | Read customer records or documents without a support access grant |
| Platform admin | View all workspaces, status, plan and usage; suspend, restore and schedule deletion of a workspace; view the platform audit log | Manage platform staff; read customer data without a grant |
| Support agent | View workspace metadata, member list, error and delivery logs; request support access | Suspend or delete workspaces; export data; read customer data without a grant |
| Analyst (read-only) | View aggregate usage and health numbers | See anything that identifies a customer's records or documents |

Rules for the operator team:
- Platform staff accounts are a separate identity from workspace memberships, live in a separate admin area on its own route group, and cannot be created through public sign-up. Only the platform owner creates them.
- MFA is mandatory for every platform account, sessions are short, and there are no shared logins.
- **Support access grant:** a staff member requests access to one workspace with a reason; the workspace owner approves it; it is read-only by default, expires automatically (24 hours at most), can be revoked by the owner at any time, and is visible to the owner in their audit log. While it is active, the staff member sees a permanent banner naming the workspace, and every page they open is logged.
- There must always be at least one platform owner; the last one cannot be removed or demoted.
- Every platform action is written to an append-only platform audit log: who, what, which workspace, when, from where.
- Removing a staff member ends all their sessions and grants immediately.
- Add tests proving that each platform role without a grant gets zero customer rows from every endpoint, and that an expired or revoked grant stops working at once.

### Customer teams

**Teams** group members and scope them to a subset of records. The acceptance test that matters: a member assigned to 50 properties cannot see, search, export, count or infer the other 470 through any screen, API route, Ask/assistant answer, CSV export, or error message.

## Audit checklist

### 1. Authentication and sessions
- Sign-up, sign-in, sign-out, email verification, password reset, and invite acceptance all work end to end, including expired, reused and tampered tokens.
- Passwords: argon2id with sensible parameters, minimum length, breached or trivial passwords rejected, no maximum that truncates.
- Sessions: random server-side IDs, cookies `HttpOnly`, `Secure`, `SameSite=Lax` or stricter; session rotated on sign-in and on privilege change; idle and absolute timeouts; sign-out and password change invalidate other sessions; sessions survive a server restart (no in-memory-only store in production).
- MFA (TOTP): enrolment, verification, recovery codes, enforced when the workspace security policy requires it; codes cannot be replayed.
- Rate limiting and lockout on sign-in, reset, invite and MFA endpoints. Responses and timing must not reveal whether an email exists.
- CSRF protection on every state-changing request, including server actions.

### 2. Authorisation (RBAC)
- Every server action, API route and data-loading function checks the session, the workspace membership and the capability on the server. Hiding a button is not a control.
- Build a table of every route and action against every role and assert the expected allow or deny in tests.
- Look for privilege escalation: a member changing their own role, an admin promoting themselves to owner, removing the last owner, editing another workspace's membership by changing an ID, accepting an invite meant for a different email.
- Team scoping is applied in the query layer, not filtered afterwards in the UI.

### 3. Tenant isolation
- Every tenant-owned table has a non-null `workspace_id`; row-level security is enabled and forced on each of them; the app sets the workspace context per request or transaction; background jobs set it explicitly.
- No query path uses a connection that bypasses RLS unless it is a clearly named platform-admin path with audit logging.
- File storage keys are prefixed per workspace and every download checks permission before issuing a signed URL.
- Run and extend the isolation test suite: two workspaces with identical data, every endpoint called as a member of A must return zero rows from B. Add any endpoint that is missing from the suite.
- IDs in URLs (record, document, object, invite, export) cannot be swapped to reach another workspace or an out-of-scope record. A denied request returns the same response as a non-existent one.

### 4. Input, output and platform security
- All input validated on the server with a schema. No string-built SQL. Dynamic object and field names from the metadata engine are allow-listed, never interpolated.
- File uploads: type and size limits, content sniffing, no path traversal, no execution, safe filenames, CSV export protected against formula injection.
- Output encoded everywhere; no unsafe HTML rendering of user or document content.
- Assistant and Ask features: answers are built only from data the current user may see; text inside uploaded documents is treated as data and can never act as an instruction; API keys never reach the browser.
- Security headers: Content-Security-Policy, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame protection.
- Secrets only in environment variables; `.env.example` complete and accurate; app fails fast with a clear message when a required variable is missing.
- Audit log records who did what, when, from where, for sign-ins, role changes, invites, exports, deletions, rule changes and support access. It is append-only and visible to owners and admins.
- `npm audit` reviewed; vulnerable dependencies upgraded or justified in the report.

### 5. Core product behaviour
This is the heart of the product. Verify each step with real data, not seed shortcuts.
- **Documents:** upload, processing state, extraction, per-field confidence, human review and confirmation, linking to the right record, re-upload and replacement. No obligation of legal weight is created from an unconfirmed date.
- **Rules engine:** recurring, offset, fixed and watch cadences; reminder ladders; leap years, month-end clamping and UK clock changes; changing a rule regenerates future obligations and leaves history untouched; minimum-interval guards hold.
- **Obligations:** created, completed, snoozed, reassigned, reopened; overdue and due-today counts agree across Today, Week, the compliance matrix and the record page.
- **Notifications:** the daily and weekly brief is actually delivered through the configured channels, once, at the right local time, with quiet hours, retry on failure and a delivery log. If delivery is not wired, wire email first and report the rest.
- **Records and custom structure:** create, edit, delete, restore, bulk actions, filtering, sorting, pagination, saved views, custom objects and fields. Concurrent edits do not lose data.
- **Import and export:** CSV import with preview, validation errors per row, duplicate handling and rollback on failure; export respects role and team scope.
- **Workspace lifecycle:** trial, active, past due (read-only), suspended, scheduled for deletion, deleted. Each state behaves as specified and cannot be bypassed through the API.
- **Templates:** switching or applying a template never corrupts existing data.
- Every button and link does something real. Remove or clearly disable anything inert; no dead "coming soon" controls on core paths.
- Every screen has loading, empty, error and permission-denied states. Errors tell the user what happened and what to do next.

### 6. UI and visual consistency
- `docs/DESIGN.md` is the source of truth. Bring every screen into line with its colour tokens, type scale, spacing, radii and component rules, in light and dark mode. No one-off colours or font sizes.
- The brand should feel like a quiet, established estate office: calm, exact, never flashy. Numbers use tabular figures. Dates use one format everywhere, in the workspace's locale and time zone.
- Status is never shown by colour alone: always colour plus icon or glyph plus text.
- Forms: visible labels, inline validation on blur, errors next to the field, submit buttons show a pending state and cannot be double-submitted, unsaved changes are protected.
- Tables: sticky header, sensible column widths, truncation with full value on hover or focus, keyboard navigation, clear selected and hover states.
- Accessibility to WCAG 2.2 AA: contrast, focus rings always visible, logical tab order, focus trapped in dialogs and returned on close, correct landmarks and headings, screen-reader names on every control, touch targets at least 44px.

### 7. Motion
- One shared set of duration and easing tokens. Small state changes 120–160ms, panels and dialogs 200–240ms, nothing over 300ms. Ease-out for entering, ease-in for leaving.
- Animate only `opacity` and `transform`. No layout-shifting animation, no bounce, no decorative looping.
- Motion must explain something: where a panel came from, that a save succeeded, that a row was removed.
- Skeletons for loading content that takes longer than 300ms; no spinner-only screens.
- Honour `prefers-reduced-motion`: replace movement with a simple fade or no animation.

### 8. Responsiveness
- Test at 360, 390, 768, 1024, 1280 and 1536px wide, in both orientations on mobile.
- No horizontal page scroll at any width. Wide tables scroll inside their own container or collapse into cards on mobile.
- Navigation becomes a mobile menu that is reachable by thumb, traps focus when open and closes on route change.
- Dialogs become full-height sheets on small screens. Sticky elements never cover content or the on-screen keyboard.
- Text never overflows or overlaps; long property addresses and names wrap or truncate cleanly.
- Hover-only actions have a touch equivalent.

### 9. Performance and reliability
- Lists and the compliance matrix stay smooth with 520+ records: server-side pagination or virtualisation, indexed queries, no N+1 loads.
- No hydration warnings, console errors or unhandled promise rejections on any route.
- Database migrations run cleanly from empty to current and are safe to re-run.
- A health endpoint reports database and storage status without leaking details.

## Definition of done

- `typecheck`, `lint`, `test` and `build` all pass.
- No open Critical or High findings. Any remaining Medium or Low item is listed with a reason.
- Isolation suite and the role-by-route permission tests pass and cover every endpoint.
- A new user can sign up, create a workspace, invite a teammate into a team, upload a document, confirm its dates, see the resulting obligation on Today, and receive the brief, without touching the database by hand.
- Every screen checked at all listed widths in light and dark mode.
- Docs updated: `README.md`, `docs/ARCHITECTURE.md`, `.env.example`, and one current `docs/STATUS.md` replacing the per-phase status files.

## Final report

Finish with `docs/AUDIT_REPORT.md` containing: a summary of what was found and fixed by severity, the list of `DECISION NEEDED` items, anything you could not verify and why (for example a missing API key), remaining risks, and the exact commands to run the app and the tests. State plainly what is not done. Do not describe anything as working unless you ran it and saw it work.
