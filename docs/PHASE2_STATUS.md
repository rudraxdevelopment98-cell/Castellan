# Phase 2 — Metadata engine: status

Per the v2.0 delivery plan. Exit criterion: **an admin creates an object with 10
fields and a relation; records validate and history shows diffs.** ✅ Met.

## Built

- **Schema** (`src/server/db/schema.ts` → `drizzle/0001_phase2_metadata.sql`):
  `object_defs`, `field_defs`, `records` (hybrid: typed columns + `data` jsonb),
  `record_links`, `record_history`, `outbox`. All tenant-scoped, all added to
  `rls.sql` — the isolation model extends to every new table.
- **Field-type registry** (`src/server/pipeline/fieldtypes.ts`): pure
  sanitise + normalise + validate for 20 field types — text, long_text, number,
  currency (→ integer minor units), percent, duration, date (UK-first → ISO),
  datetime (→ UTC), boolean, single/multi_select, status, email, phone (→ E.164),
  url, address (UK postcode normalised), person, relation, file, sensitive_text,
  auto_number. (formula/rollup/lookup deferred to Phase 6.)
- **Pre-processing pipeline** (`src/server/pipeline/index.ts`): the one path every
  write goes through — defaults → per-field sanitise/normalise/validate →
  duplicate (unique) detection → relation/person existence + scope → enrich
  (title, links). Errors returned per field: `{ field, code, message,
  value_received, suggestion }`.
- **Metadata domain** (`src/server/metadata.ts`): create object, add field
  (immutable `api_name`), load object + fields, list objects — scoped and gated by
  `structure.manage`.
- **Records domain** (`src/server/records.ts`): create / update / soft-delete /
  restore / get / list, all through the pipeline, with:
  - **field-level history diffs** (who / when / before / after / source),
  - **optimistic locking** (version check; conflict reports the changed fields),
  - **soft delete** (30-day bin semantics via `deleted_at`),
  - **record numbering** (PRP-00001 style, optional per object),
  - **record scope** (`all` / `assigned` enforced in the query layer; `team` /
    `filter` are follow-ups),
  - an **outbox event written in the same transaction** as the record (spec: no
    side effect is lost if a worker crashes).

## Tests

**69 passing** (32 rules engine + 9 isolation + 5 auth-flow + 13 field registry +
10 metadata/records). Typecheck clean, app builds. New Phase 2 coverage:

- object with 10 fields incl. a relation is created and read back;
- values normalise on write (`£1,500`→150000; `yes`→true; `03/04/2030`→
  `2030-04-03`; `MGR@Example.com`→`mgr@example.com`; postcode `e1 8ab`→`E1 8AB`);
- required-field rejection with a field error; unique enforcement; relation to a
  non-existent record rejected;
- update produces the right per-field history diffs (and none for unchanged
  fields); stale update blocked by the optimistic lock; soft delete + restore;
- records and objects do not leak across workspaces.

Spec acceptance tests covered here: postcode normalisation, UK date parsing,
required-field gating, and the isolation guarantees.

## Stubbed / deferred

- **UI**: the object/field builder and the record grid are **Phase 3** (the full
  `data_grid` spec, saved views, board/calendar, import wizard). Phase 2 is the
  engine beneath them; it is exercised here through tests, not yet a screen.
- **Outbox worker**: events are written transactionally; the consumer (rules,
  notifications, search indexing, rollup recompute) is Phase 4.
- **Field changes**: type-change dry-run, delete-field 30-day recovery, and
  make-required/unique backfill checks (spec field_change_rules) — next in Phase 2.x.
- **formula / rollup / lookup** field types — Phase 6.
- **Template application**: onboarding stores the chosen template id but does not
  yet materialise its objects/fields into the workspace; wiring the v1 template
  content into `object_defs`/`field_defs` is a small follow-up.

## Open risks

1. **jsonb uniqueness at scale**: unique checks currently query `data ->> key`;
   for large objects these should be backed by expression indexes created when a
   field is marked `unique`/`filterable` (spec storage_design). Add the
   index-generation step before high row counts.
2. **Dev schema drift**: an existing `.castellan-dev-db` is not re-migrated
   automatically (bootstrap runs once). Delete it after pulling schema changes;
   production applies migrations + `rls.sql` at deploy.
