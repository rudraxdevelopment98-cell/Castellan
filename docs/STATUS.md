# What was built, what is stubbed, known risks

Per the spec's final instruction to the builder.

## Built and working

- **Rules engine** — cadences, conditions, reminder ladders, urgency banding,
  compliance-matrix status, one-off handling, minimum-interval guard (rent
  increase once a year). **32 unit tests pass**, covering leap years, month-end
  clamping, BST transitions, and the spec's headline acceptance tests.
- **Generic template system** — 4 rule packs (UK landlord flagship + hospitality,
  fleet, generic business). Switching templates re-renders every screen from the
  same engine. This is the concrete proof it works for any business.
- **Screens** — Today (with morning brief + money line), This week (+ 90-day
  clusters), Compliance matrix (+ PRS readiness), Records (filterable), Record
  detail, Documents (inbox + interactive review queue), Ask (cited), Settings
  (template switcher + editable rule table + security page).
- **Seed data** — deterministic 520 London properties, 3 ownership entities, 30
  HMOs, ~40% EPC D-or-below, a review queue, and a curated set of urgent items so
  Today mirrors the spec narrative (2 overdue: a lapsed insurance and a gas check).
- **Design system** — full token set, dark mode, WCAG 2.2 AA status encoding,
  every listed anti-pattern avoided. Light + dark screenshots in `docs/`.
- **Build** — `npm run build` is clean; all routes render (verified via HTTP).

## Acceptance tests from the spec — status

| Spec acceptance test                                              | Status |
| ---------------------------------------------------------------- | ------ |
| Gas record 10 Oct 2026 → next check due 10 Oct 2027, right ladder | ✅ unit-tested |
| Only after a human confirms the date (provisional flag)          | ✅ modelled |
| Uninsured property shows red on Today and in the matrix          | ✅ |
| Second rent increase within 12 months is blocked                 | ✅ unit-tested |
| London PRS due 14 Oct 2027 (region-driven)                       | ✅ |
| Changing a rule's ladder regenerates future, not history         | ✅ unit-tested |
| Morning brief for 520 properties is one message                  | ✅ |
| Every Ask answer links back to a record                          | ✅ |
| Staff assigned to 50 properties can't see the other 470          | ⚠️ modelled in types, not enforced (no auth layer in Phase-1 demo) |

## Stubbed (designed, not wired — needs backend / keys)

- **Persistence** — in-memory store instead of UK-region Postgres with RLS. All
  reads are already funnelled through `store.ts` for a clean swap.
- **Auth / MFA / RBAC** — roles exist in the model; no login, session or
  row-level enforcement yet. `.env.example` documents the intended wiring.
- **Real document AI** — the pipeline and review UI are complete; extraction is
  represented by pre-filled seed facts rather than live LLM calls.
- **Notification delivery** — the morning brief is composed and rendered;
  WhatsApp / email / push send, quiet hours, escalation and delivery log are not
  wired.
- **Open Banking / bank matching, contractor upload links, PDF report export,
  bulk assign & snooze actions** — designed in the spec; buttons are present but
  inert in the demo.
- **Custom types/fields/rules builder & no-code rule preview** — the data model
  supports custom fields and the rule table is data-driven; the visual builder UI
  is Phase-2.

## Known risks

1. **Legal accuracy drifts.** Every statutory rule carries a `last_verified`
   date; uncertain ones ship disabled and flagged. Before go-live, a
   UK-qualified adviser must re-verify all dates (RRA phasing, PRS windows/fees,
   MTD thresholds, borough licensing schemes).
2. **Extraction confidence.** Bulk paper ingestion is the hardest part; the human
   review gate (nothing legal from an unreviewed date) is the safety net, and the
   0.9 threshold is admin-tunable per document type.
3. **Address matching at scale.** 520+ records need robust normalised
   address/postcode/UPRN matching to avoid mis-linking documents; the demo uses
   suggestion lists with confidence.
4. **Notification fatigue.** At 500 properties, digest-by-default is essential;
   only true urgencies go individual. Escalation ladders need real-world tuning.
5. **Multi-entity tax/finance** (per-company vs personal, MTD vs Corporation Tax)
   is modelled lightly and needs an accountant's review before the Money module.

## Next steps

Phase-2 per the spec: custom types/fields from samples, the no-code rule builder,
the Money module with bank matching, contractor upload links, and the PRS
readiness report — then Phase-3 Ask depth, reports/audit export, EPC-2030
planner, and multi-account billing.
