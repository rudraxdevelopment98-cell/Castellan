# Castellan v2.0 — Gap analysis & migration plan

**From:** the working v1.0 prototype (this repo)
**To:** the multi-tenant, metadata-driven SaaS in `castellan_platform_spec v2.0`
**Status:** plan for approval — no v2.0 code written yet.

---

## 1. Where the prototype stands today

What exists and works (verified, tested, deployed live):

| Area | v1.0 prototype |
| --- | --- |
| Framework | Next.js 15 App Router, TypeScript, Tailwind (design tokens) |
| Rules engine | Pure, dependency-free, 33 unit tests; cadences, ladders, obligations, matrix status |
| Templates | Landlord (flagship) + hospitality/fleet/generic, as hard-coded TS objects |
| Screens | Today, This week, Compliance matrix, Records, Record detail, Documents (mock review), Ask (deterministic), Assistant (Claude + fallback), Settings |
| Assistant | `/api/chat`, Claude-backed, grounded in data, streaming, graceful fallback |
| Data | **In-memory deterministic seed** (520 properties). No database. |
| Hosting | Live on Vercel |

**The honest summary:** the prototype is exactly what v2.0 calls "the Landlord template *content*". v2.0 asks us to build **the engine underneath it**. Almost none of that engine exists yet.

---

## 2. Gap analysis (v2.0 requirement → current state → gap)

| v2.0 capability | Current state | Gap size |
| --- | --- | --- |
| **Multi-tenancy** (Workspace/Team/Member, `workspace_id` everywhere, RLS, isolation test suite) | None — single implicit workspace | **Very large** |
| **Auth** (email/passkey, Argon2id, MFA, sessions, invites) | None | **Very large** |
| **Roles & permissions** (system + custom roles, field-level, record scope enforced in query layer) | None | **Very large** |
| **Persistence** (PostgreSQL 16, jsonb + expression indexes, tsvector, pg_trgm) | In-memory seed only | **Very large** |
| **Metadata engine** (runtime Objects/Fields/Relations/Layouts, 25 field types, dry-run type changes) | Field defs are compile-time TS types | **Very large** |
| **Record CRUD** (create/edit/bulk/duplicate/soft-delete/history/concurrency/comments) | Read-only rendered views | **Large** |
| **Data grid** (TanStack Table+Virtual, column ops, filter builder, grouping, saved views, keyset pagination, board/calendar/timeline) | Static server tables + one client filter | **Large** |
| **Import/export** (wizard, mapping, dedupe, dry-run, undo; export; REST API; webhooks) | None | **Large** |
| **Rules builder** (WHEN/IF/THEN UI, previews, loop protection, run logs) | Rules exist as data but no builder/triggers/actions | **Medium–large** |
| **Pre/post-processing pipeline** (shared Zod, authorise→sanitise→normalise→validate→dedupe→enrich; outbox workers) | Ad-hoc, no shared pipeline, no jobs | **Large** |
| **Documents** (Tesseract/PaddleOCR worker, extraction templates, review gate) | Mock review UI, pre-filled facts | **Large** |
| **Ask engine v2** (grammar, chips, synonyms, permission-scoped, failed-question log) | Simpler intent matcher, no chips/synonyms | **Medium** |
| **Billing** (Stripe, plans, seat/record limits) | None | **Medium** |
| **Security/compliance** (RLS, field encryption, audit chain, malware scan, backups, GDPR tooling) | Documented aspirations only | **Very large** |
| **Platform admin console** (separate auth, support-access grants) | None | **Medium** |
| **UI system depth** (z-index scale, sticky rules, motion tokens, 6 mandatory screen states, responsive down to 360px) | Partial (tokens, some states) | **Medium** |

**Net:** ~15% of v2.0 exists (the template content + rules-engine core + design language). ~85% is new platform engineering.

---

## 3. What carries over vs. gets rebuilt

**Keep and wrap (high reuse):**
- The **rules engine** (`src/lib/rules/*`) — pure and tested; becomes the generic obligation engine. Its cadence/date/ladder logic is directly reusable.
- **Design tokens & components** — carry over verbatim; extend, don't replace.
- **Template *content*** — the landlord/hospitality/fleet field & rule definitions become the seed for v2.0 **Template packages** (JSON).
- **Ask & notify logic** — becomes the basis for the v2.0 Ask engine and notification composer.

**Rebuild (the engine):**
- Data access: in-memory store → Postgres + RLS + a single scope-injecting query layer.
- Field definitions: compile-time TS → runtime **metadata** (objects/fields/relations rows) + jsonb record store.
- Screens: fixed-column tables → metadata-driven TanStack grid with saved views.
- Everything auth/tenancy/billing/jobs: net new.

---

## 4. Key architecture decisions (proposed, matching the spec)

1. **DB & tenancy:** PostgreSQL 16, one shared database, **RLS on every tenant table**, `app.workspace_id` set per request/transaction. Hybrid record store: typed `record` table + `data jsonb` + generated indexes for `filterable`/`unique` fields. (Spec's recommended design.)
2. **Provider:** Supabase (Postgres + Auth + Storage + RLS, UK region `eu-west-2`) **or** Neon + Auth.js + S3. → *decision needed (see below).*
3. **Shared validation:** one set of **Zod schemas** driving both client forms and the server pre-processing pipeline (authorise→sanitise→normalise→validate→dedupe→enrich).
4. **Jobs:** transactional **outbox** table + worker (Inngest or BullMQ/Redis) for rules, notifications, imports, OCR, webhooks, digests.
5. **Grid:** TanStack Table + Virtual + Query, keyset pagination, URL-serialised view state.
6. **No paid AI:** OCR via containerised Tesseract; Ask stays deterministic; `DocumentReader`/`QueryInterpreter` provider interfaces default to no-op. *(Note: this v2.0 rule supersedes the Claude assistant I just shipped — see the open question below.)*
7. **Isolation test suite in CI** before the second template — blocks deploy on any cross-tenant leak.

---

## 5. Migration plan (follows the spec's delivery_plan, mapped to this repo)

Each phase ends with: what was built, what was stubbed, test results, open risks.

- **Phase 0 — Scaffolding (new):** add DB, migrations tooling (Drizzle), env config, Zod shared package, test harness for RLS. Keep the current in-memory app running side-by-side behind a flag until Phase 3 replaces it.
- **Phase 1 — Foundations:** auth, workspaces, members, roles, teams, invites; RLS + **isolation test suite**; audit log; basic platform admin. *Exit:* two workspaces provably isolated in CI.
- **Phase 2 — Metadata engine:** objects, fields (all but formula/rollup), relations; record CRUD, history, soft delete; pre/post pipeline + outbox. *Exit:* admin builds a 10-field object with a relation; validation + diffs work.
- **Phase 3 — Data grid & views:** full grid spec; saved views, board, calendar; import wizard + export. *Exit:* 100k records meet perf budgets; 5k-row import with error report + undo. **This is where the current prototype screens are replaced by metadata-driven ones.**
- **Phase 4 — Rules, obligations, notifications:** generic rule builder; Today/This week regenerated from metadata; digests. *Exit:* Landlord template reproduces v1.0 behaviour on imported data.
- **Phase 5 — Documents & Ask:** OCR worker, extraction templates, review queue; Ask v2 with chips + fallback search. *Exit:* gas-cert extraction with source highlight; 20 sample questions correct.
- **Phase 6 — Templates, billing, hardening:** clinic + fleet templates; formula/rollup; Stripe; pen test, backup drill, a11y audit. *Exit:* self-serve sign-up to paid plan.

**Realistic sizing:** each phase is days–weeks of focused work, not hours. This is a genuine platform build.

---

## 6. Open questions that change what I build (need your call)

1. **DB/auth stack:** Supabase (fastest path: Postgres+Auth+Storage+RLS in one, UK region) vs. Neon+Auth.js+S3 (more control). Both need credentials/a project you create.
2. **The Claude assistant I just shipped:** v2.0 says "zero paid AI keys". Keep it as an *optional, off-by-default* provider slot (recommended — it already degrades to the deterministic engine), or remove it entirely?
3. **Live demo during rebuild:** keep the current Vercel demo running as the public "Demo workspace" while the platform is built behind it? (Recommended.)
4. **Scope for now:** build the whole thing phase-by-phase, or start with **Phase 1 (Foundations)** only and review before continuing? (The spec says build in order and wait for approval at the plan stage — which is here.)

Nothing in v2.0 will be built until you confirm 1–4.
