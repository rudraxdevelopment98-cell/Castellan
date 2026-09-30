# Castellan

**Read every document once, turn it into dated obligations, and know exactly what needs doing today.**

Castellan is an AI-assisted operations desk for anyone who has to keep a lot of
paperwork in date order. Its flagship template is the **UK portfolio landlord**
(500+ residential lets, hundreds of certificates, insurances and loans), but the
engine is generic: **any business that tracks documents and wants to be told
before something expires** — a hospitality group, a vehicle fleet, or a company
managing contracts and certifications — runs on the same core by switching the
rule pack.

> _Every great estate had a castellan — the trusted keeper who held every key and
> kept every duty in order while the owner was away. This one is digital._

---

## The idea in one line

```
Document → extract facts → rules engine → dated Obligations → daily brief
```

A document is uploaded, facts (dates, amounts, parties) are extracted and
human-confirmed, a **rules engine** turns those facts into **obligations** with
due dates and reminder ladders, and a **notification engine** turns obligations
into a single morning brief: _"12 things today, 2 overdue."_

Everything the landlord cares about — gas checks, EICRs, EPCs, licences,
insurance renewals, mortgage product-ends, deposit deadlines, the new PRS
Database registration — is just **data fed into that one engine.** No rule is
hard-coded.

## Why it generalises to any business

The engine knows nothing about landlords. It turns a *trigger date* plus a
*cadence* (recurring / offset / fixed / watch) into obligations. Landlord
compliance, restaurant hygiene, fleet MOTs and generic contract renewals are all
just **rule packs** (`src/lib/data/templates/`). Adding an industry is adding one
template — no engine changes. Switch templates live under **Settings**.

## What's here (Phase 1)

- **Rules engine** — pure, dependency-free, fully unit-tested TypeScript with
  correct date maths (leap years, month-end clamping, BST-safe date-only
  arithmetic). This is the product's first promise: dates and money are right.
- **Today** — the home screen: overdue, due today, and long-lead items whose
  reminder rung fires today, plus the morning brief and the money line.
- **This week** — seven-day planner with a 90-day cluster lookahead.
- **Compliance matrix** — the signature ledger: every record × every requirement
  as status squares (colour + glyph + label, WCAG 2.2 AA), with PRS-registration
  readiness.
- **Records** — dense, filterable register (520 seeded London properties).
- **Documents** — processing inbox + review queue with per-field confidence,
  page-level evidence, and required human confirmation of critical dates.
- **Ask** — question-answering over your own data only, every answer cited.
- **Settings** — template switcher, the editable rule table (with last-verified
  dates and "needs verification" flags), and the security page.

Screenshots are in [`docs/screenshots/`](docs/screenshots) (light + dark).

## Run it

```bash
npm install
npm test        # 32 rules-engine tests
npm run dev     # http://localhost:3000
```

The Phase-1 demo runs entirely on deterministic in-memory seed data — no
database or API keys required. `.env.example` documents the production wiring
(UK-region Postgres, encrypted object storage, vision-LLM extraction, WhatsApp /
email / push, Open Banking).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data model, rules engine, pipeline.
- [`docs/DESIGN.md`](docs/DESIGN.md) — design tokens and the anti-patterns avoided.
- [`docs/STATUS.md`](docs/STATUS.md) — what's built, what's stubbed, known risks.

## A note on the legal rules

Every UK statutory rule is seeded as **editable data** with a `last_verified`
date (2026-09-30). They are correct to the best of research on that date, but law
changes — the product never hard-codes them, and anything uncertain is shipped as
a **disabled** rule flagged _needs verification_. Castellan shows rule sources
and suggests confirming with a solicitor or accountant before decisions; it never
presents legal or tax advice as fact.
