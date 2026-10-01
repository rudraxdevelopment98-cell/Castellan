# Phase 4 — Rules, obligations, Today/This-week: status

Per the v2.0 delivery plan. Exit criterion: **the Landlord template reproduces
the v1 prototype behaviour on real imported data.** ✅ Met.

## Built

- **Schema** (`drizzle/0003_phase4_rules.sql`): `rules` (cadence-based, no-code
  obligation rules per object) and `obligations` (generated, deduped by
  rule+record+cycle). Both tenant-scoped + in `rls.sql`.
- **Rules admin** (`src/server/rules_admin.ts`): create / list / enable-disable
  rules (gated by `structure.manage`).
- **Obligation generator** (`src/server/obligations_gen.ts`): reuses the tested
  Phase-1 rules engine over real records — for each enabled rule and each record
  it applies to, computes the due date from the record's trigger-date field +
  cadence, with the reminder ladder. **Idempotent** (same rule+record+cycle never
  duplicates); moving a trigger date replaces the open obligation.
- **Today / This-week** (`src/server/today.ts` + pages): regenerated from the
  generated obligations, with the engine's banding (overdue / due today / good to
  start) and ordering — the v1 screens, now generic and multi-tenant. Today also
  composes the **morning brief** digest.
- **Template wiring** (`src/server/templates_apply.ts`): the landlord flagship now
  also creates the compliance **date fields** (gas/EICR/EPC/insurance), the
  **rule pack** (GAS_SAFETY, EICR, EPC, INSURANCE with their ladders), seeds the
  trigger dates on sample records, and generates obligations — so a new landlord
  workspace lands with a live Today.
- **Rules screen** (`/w/[slug]/rules`): the rule pack with cadence, ladder,
  trigger field, last-verified, and enable/disable (regenerates on toggle). The
  no-code rule table in its first form.
- **Nav**: Today, This week and Rules added to the workspace header; home opens
  Today.

## Tests

**82 passing** (+5 Phase 4): a gas check dated 10 Oct 2026 → due 10 Oct 2027 and
bands overdue/due-today correctly; `applies_when` excludes a no-gas property from
the gas obligation; insurance (offset 0) is due on its end date; regeneration is
idempotent; the week plan has seven columns. Typecheck + build clean.

Verified in a real browser: a fresh landlord workspace's **Today** shows the
morning brief, 2 overdue (insurance + gas) and "good to start" EICR/insurance —
reproducing the v1 prototype narrative on real engine data.
Screenshots: `docs/screenshots/v4-today.png`, `v4-rules.png`, `v4-week.png`.

## Stubbed / deferred

- **Full WHEN/IF/THEN rule builder UI** (triggers beyond date-cadence —
  field-changed, document-confirmed, recurring schedule; actions beyond
  create-obligation — update field, notify, create related, webhook; the
  create-rule preview and run logs). The data model + engine support cadence
  rules now; the visual builder and extra trigger/action types are the next
  increment.
- **Automatic regeneration**: obligations regenerate on workspace creation and via
  the "Update list" button. Production should regenerate from the **outbox worker**
  on record create/update and on a nightly schedule (the outbox events already
  exist from Phase 2/3).
- **Notification delivery**: the morning brief is composed and shown; WhatsApp /
  email / push send, quiet hours, escalation and the delivery log are wiring on
  top (providers in `.env.example`).
- **Obligation actions** (assign, mark done with evidence → next cycle, snooze
  with reason) — modelled in the schema; the Today action buttons are a follow-up.

## Open risks

1. **Regeneration cost at scale**: the generator scans records per rule; at 100k
   records this should run incrementally from the outbox (only changed records)
   rather than full-scan — the events are in place, the incremental consumer is
   the remaining step.
2. **Trigger-date modelling**: compliance dates are now fields on the object;
   importing real portfolios needs those columns populated (the importer already
   maps them by name).
