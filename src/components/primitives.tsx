import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-rule bg-surface px-5 py-4 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">{title}</h1>
          {meta ? <div className="mt-1 text-meta text-ink-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Panel({
  title,
  children,
  right,
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-rule bg-surface">
      {title ? (
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="text-section font-semibold text-ink">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "overdue" | "ok" }) {
  const color = tone === "overdue" ? "text-overdue" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="rounded-panel border border-rule bg-surface px-4 py-3">
      <div className={`tnum text-title font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-meta text-ink-muted">{label}</div>
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  href,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
}) {
  const cls =
    variant === "primary"
      ? "bg-brand text-white hover:opacity-90"
      : "border border-rule bg-surface text-ink hover:bg-canvas";
  const classes = `inline-flex items-center justify-center rounded-ctl px-3 py-1.5 text-table font-medium transition-colors ${cls}`;
  if (href) return <Link href={href} className={classes}>{children}</Link>;
  return <button className={classes}>{children}</button>;
}

export function Content({ children }: { children: ReactNode }) {
  return <div className="space-y-5 px-5 py-5 md:px-8 md:py-6">{children}</div>;
}
