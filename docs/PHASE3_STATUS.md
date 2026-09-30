# Phase 3 — Data grid & views: status

Per the v2.0 delivery plan. Exit criterion: **a workspace's records are browsable
and editable in a grid; import of rows with an errors report and undo works.**
✅ Met (import verified for a small batch; keyset pagination is in place for the
100k target — see notes).

## Built

- **Template materialisation** (`src/server/templates_apply.ts`): creating a
  workspace with a template now writes real `object_defs` / `field_defs` and
  optional sample records into the engine. A new landlord workspace lands with a
  **Property** object (11 fields) and 25 sample records — so the grid is live
  immediately. Wired into onboarding (with a "add sample data" toggle).
- **Data grid** (`/w/[slug]/o/[objectApiName]`): server-rendered table with
  columns from field defs, **typed value rendering** (money, dates, select
  labels, booleans, addresses), record count, quick **search** (title + data),
  **keyset "Load more" pagination**, Sample badges, and New / Import / Export.
- **Record detail** (`/…/[recordId]`): all fields formatted for reading, inline
  **edit** form, and a **History** tab showing field-level before → after diffs.
- **Record create/edit** (`RecordForm` + `/api/records`): per-field inputs by
  type, server validation through the Phase 2 pipeline, **per-field error
  messages**, and optimistic-lock conflict reporting.
- **Import wizard** (`/…/import` + `ImportWizard` + `/api/import`): paste or
  upload CSV → auto-map columns to fields by name → **dry-run** (ready / skipped
  with per-row errors, nothing written) → **commit** valid rows (tagged with an
  `import_id`) → **one-click undo** that removes exactly that batch.
- **Export** (`/api/export`): current view (respecting search + record scope) to
  CSV, with money as decimals and formula-injection neutralised.
- **Query layer** (`src/server/records_query.ts`): keyset pagination on
  `(updated_at, id)` — never offset — plus search and simple field filters; a
  backing index was added for the default order.
- **Data-model screen** (`/w/[slug]/data`): lists objects + fields and lets an
  admin create objects and add fields (all 19 non-computed types) — the no-code
  builder in its first form.
- **CSV parser** (`src/server/csv.ts`): dependency-free RFC-4180 parse + safe
  stringify.

## Tests

**77 passing** (+8 Phase 3): template materialisation (object + 25 samples), CSV
parse (quotes/commas/newlines) + injection-safe export, import **dry-run /
commit / undo**, **keyset pagination** (pages with no overlap, correct page
count), search narrowing, and CSV export shape. Typecheck + build clean.

Verified end-to-end in a real browser (Playwright): signup → onboarding with
samples → the Properties grid shows 25 typed records → open a record (detail +
history) → create a record → import a CSV (2 valid, 1 skipped) → commit.
Screenshots: `docs/screenshots/v3-grid.png`, `v3-record.png`, `v3-import.png`.

## Stubbed / deferred (documented follow-ups)

- **Board / calendar / timeline / matrix views** and **saved views** persistence
  — the grid is the Table view; the other view types and saving a view are next.
- **Full nested filter builder** (AND/OR groups, all operators, facets) — the
  query layer supports simple field filters; the visual builder is a follow-up.
- **Inline cell editing, bulk actions, grouping, column manager** (show/hide,
  reorder, resize, pin) — the grid renders a sensible default column set for now.
- **100k performance proof**: pagination is keyset (not offset) and indexed, so
  it is built for the target; a full 100k benchmark needs the Supabase Postgres
  instance (PGlite in tests covers correctness at smaller scale).
- **Import at 200k rows / background job**: current import runs inline in one
  transaction — good for thousands; large files should move to the outbox worker
  (Phase 4) with progress + email.
- **Field change safety** (type-change dry-run, delete-field recovery,
  make-required backfill) — Phase 2.x.

## Open risks

1. **jsonb filter/sort at scale**: field filters use `data ->> key`; fields
   marked `filterable`/`unique` should get generated expression indexes (spec
   storage_design) before large row counts — the hook exists (`filterable` flag),
   the index generation is the remaining step.
2. **Inline validation UX**: create/edit show server-side field errors on submit;
   on-blur client hints (shared Zod) are a refinement.
