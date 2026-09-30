# Design

The intent (from the spec): _a well-run estate office ledger turned into
software — calm, precise, dense with information but never cluttered. Built for
someone who trusts paper._ No hype, no decoration, no AI theatrics.

## Tokens

Defined once as CSS variables in `src/app/globals.css` and mirrored in
`tailwind.config.ts`.

- **Colour** — cool paper white canvas (`#F6F7F5`), white surfaces, Georgian
  door green brand (`#2E5B4F`) used only for primary actions and selection, aged
  brass accent (`#A8844A`) used sparingly. Status colours: overdue (rust), due
  soon (amber), ok (green), missing (muted violet), n/a (grey).
- **Type** — Instrument Sans for UI, Cormorant Garamond for the wordmark only.
  Tabular figures (`.tnum`) for every money value and date, right-aligned in
  tables. Sentence case everywhere; no all-caps labels.
- **Shape** — borders, not shadows (one shadow, reserved for menus/dialogs).
  Distinct radii: 2px matrix squares, 6px controls, 8px panels.
- **Dark mode** — provided, via `prefers-color-scheme` and a `data-theme`
  override hook.

## The signature element

The **compliance matrix**: a tight grid of small status squares, one row per
record, readable at a glance like a ledger. The visual boldness is spent here;
everything else stays quiet.

## Accessibility (WCAG 2.2 AA)

Status is **never colour alone** — every status square carries a colour, a glyph
(`✓ ! × ? –`) and a text label, so the grid is legible in greyscale and to
colour-blind users. Visible keyboard focus, reduced-motion respected, 44px touch
targets on mobile, `aria-current` on navigation.

## Anti-patterns deliberately avoided

Per the spec's `ui_ux.anti_patterns`, this product has **none of**: gradients,
glassmorphism, glowing borders, purple/blue "AI" palettes, sparkle emojis, any
emoji in the UI, a dashboard of identical rounded cards with soft shadows, big
vanity numbers with tiny labels, all-caps eyebrow labels, `A · B · C` metadata
strings, arrows appended to button text, fade-and-slide animations on every
section, or stock illustrations / 3D blobs in empty states.

AI presence is quiet: extracted values simply appear with a small confidence
marker and a "Page 2" evidence link; Ask is a search box with cited table
results, not a chat mascot.

## Copy

Plain words the user uses — "Gas check due", not "CP12 obligation instance".
Addresses are the identifier, always with postcode. Buttons say exactly what
happens. Dates as "14 Oct 2027", money as "GBP 40,077" — never the ambiguous
03/04 form. The voice is a calm steward: _"Three renewals need your attention
this week."_ Never salesy, never exclamation marks.
