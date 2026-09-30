# Architecture

## Layers

```
src/lib/rules/     Pure rules engine — no I/O, no framework. Fully unit-tested.
  dates.ts         Date-only calendar arithmetic (BST-safe, leap years, month-ends).
  types.ts         Rule / record / obligation domain types.
  engine.ts        Conditions, due-date computation, reminder ladders, banding, matrix status.
  engine.test.ts   32 tests with fixed dates.

src/lib/data/      Data model + templates + seed + store.
  types.ts         App-level model (workspace, users, documents, custom fields).
  templates/       Rule PACKS (this is where "any business" lives).
    landlord.ts    UK residential landlord (flagship), seeded from the spec.
    business.ts    Hospitality, fleet, generic business.
    index.ts       Template registry.
  seed.ts          Deterministic 520-property demo generator + review-queue docs.
  store.ts         In-memory data access (swap for Postgres queries in prod).

src/lib/domain/    Read models that turn data into screens.
  views.ts         Today plan, week plan, lookahead, compliance matrix, readiness.
  notify.ts        Morning-brief composition (one digest, never spam).
  ask.ts           Cited Q&A over the account's own data.
  format.ts        UK date / GBP formatting.
  clock.ts         Demo clock (pinned to 2026-09-30; CASTELLAN_LIVE_CLOCK=1 for real).
  params.ts        Resolve active template + today from a page's searchParams.

src/app/           Next.js App Router pages (server components).
src/components/    UI: Sidebar, status squares, tables, document review, template switcher.
```

The dependency arrow only ever points **down**: `app` → `domain` → `data` →
`rules`. The rules engine depends on nothing.

## The rules engine

A rule is data:

```ts
{
  code: "GAS_SAFETY",
  appliesWhen: [{ field: "has_gas", op: "eq", value: true }],
  triggerField: "GAS_SAFETY",                 // last inspection date
  cadence: { kind: "recurring_months", every: 12 },
  reminderLadderDays: [60, 30, 14, 7, 1],
  evidenceRequired: true,
  ...
}
```

**Cadences** decide how the due date is derived from the trigger date:

| Cadence            | Meaning                                   | Example                     |
| ------------------ | ----------------------------------------- | --------------------------- |
| `recurring_months` | due = last-done + N months                | Gas safety (12)             |
| `recurring_years`  | due = last-done + N years                 | EICR (5), EPC (10)          |
| `offset_days`      | due = anchor + N days                     | Deposit protection (30)     |
| `offset_days: 0`   | the document states the due date directly | Insurance / licence expiry  |
| `fixed_date`       | a statutory deadline                      | PRS Database (14 Oct 2027)  |
| `watch`            | no due date yet, kept on the radar        | PRS Ombudsman (~2028)       |

**One-off vs recurring** — deposit protection and right-to-rent are `oneOff`:
once the deadline has passed with a recorded date they read as *completed*, not
perpetually overdue, unlike a renewal that comes round again.

**Correctness** is the whole point, so date maths is done on calendar dates
(`YYYY-MM-DD`), never wall-clock instants — BST transitions can never move a due
date by a day. `addMonths` clamps to month-ends (31 Jan + 1m → 28/29 Feb). Every
edge is pinned in `engine.test.ts`.

**Provisional obligations** — an obligation whose trigger came from an
*unconfirmed* document is marked `provisional` and excluded from notifications:
nothing creates a legal reminder from an unreviewed date.

## Document AI pipeline (design)

`Received → Read → Needs review → Confirmed`. Classify with a cheap model,
extract with a strong vision model into a strict JSON schema (value + confidence
+ page + snippet per field), validate deterministically (real dates, end after
start, postcode/policy patterns), match to a record by address, and require a
human tick for any critical date/money field or anything below the confidence
threshold (default 0.9, admin-editable). Text inside documents is data, never
instructions — the extractor has no tool access.

## Data model → PostgreSQL

The in-memory `store.ts` mirrors the spec's `data_model`. In production each read
becomes a Postgres query scoped by `account_id` with row-level security; the
function signatures do not change. Sensitive fields (account references, ID docs,
key-safe codes) are field-level encrypted, and every sensitive view/confirmation/
change is written to an immutable audit log.
