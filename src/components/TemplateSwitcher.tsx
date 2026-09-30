"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TemplateOption {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  ruleCount: number;
}

/**
 * Switches the whole workspace to a different template (rule pack). This is the
 * concrete proof that Castellan is not landlord-only: the same engine, screens
 * and notifications work for any business by swapping the pack.
 */
export function TemplateSwitcher({
  options,
  active,
}: {
  options: TemplateOption[];
  active: string;
}) {
  const pathname = usePathname();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((t) => {
        const isActive = t.id === active;
        const href = t.id === "uk-landlord" ? pathname : `${pathname}?t=${t.id}`;
        return (
          <Link
            key={t.id}
            href={href}
            className={`block rounded-panel border px-4 py-3 transition-colors ${
              isActive
                ? "border-brand bg-brand-weak"
                : "border-rule bg-surface hover:bg-canvas"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-table font-medium text-ink">{t.name}</span>
              {isActive && <span className="text-meta font-medium text-brand">Active</span>}
            </div>
            <p className="mt-1 text-meta text-ink-muted">{t.tagline}</p>
            <p className="mt-2 text-meta text-ink-muted">
              {t.audience} · {t.ruleCount} rules
            </p>
          </Link>
        );
      })}
    </div>
  );
}
