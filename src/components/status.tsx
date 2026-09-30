import type { CellStatus } from "@/lib/rules/types";
import type { UrgencyBand } from "@/lib/rules/engine";

/**
 * Status is never carried by colour alone (WCAG 2.2 AA). Each status has a
 * colour AND a distinct glyph AND a text label, so the matrix is legible to
 * colour-blind users and in greyscale print.
 */

const CELL_META: Record<CellStatus, { label: string; glyph: string; className: string }> = {
  valid: { label: "Valid", glyph: "✓", className: "bg-ok text-white" },
  due_soon: { label: "Due soon", glyph: "!", className: "bg-due-soon text-white" },
  overdue: { label: "Overdue", glyph: "×", className: "bg-overdue text-white" },
  missing: { label: "Missing", glyph: "?", className: "bg-missing text-white" },
  not_applicable: { label: "N/A", glyph: "–", className: "bg-na text-ink-muted" },
};

export function StatusSquare({ status }: { status: CellStatus }) {
  const m = CELL_META[status];
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-sq text-[11px] font-semibold leading-none ${m.className}`}
      title={m.label}
      role="img"
      aria-label={m.label}
    >
      {m.glyph}
    </span>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-ink-muted">
      {(Object.keys(CELL_META) as CellStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusSquare status={s} />
          {CELL_META[s].label}
        </span>
      ))}
    </div>
  );
}

const BAND_META: Record<UrgencyBand, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "text-overdue border-overdue/40 bg-overdue/10" },
  due_today: { label: "Due today", className: "text-due-soon border-due-soon/40 bg-due-soon/10" },
  start_soon: { label: "Start today", className: "text-brand border-brand/30 bg-brand-weak" },
  later: { label: "Later", className: "text-ink-muted border-rule bg-surface" },
  watch: { label: "Watch", className: "text-missing border-missing/30 bg-missing/10" },
};

export function BandBadge({ band }: { band: UrgencyBand }) {
  const m = BAND_META[band];
  return (
    <span className={`inline-flex items-center rounded-ctl border px-2 py-0.5 text-meta font-medium ${m.className}`}>
      {m.label}
    </span>
  );
}
