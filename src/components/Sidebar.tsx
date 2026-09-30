"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/week", label: "This week" },
  { href: "/records", label: "Records" },
  { href: "/compliance", label: "Compliance" },
  { href: "/documents", label: "Documents" },
  { href: "/assistant", label: "Assistant" },
  { href: "/ask", label: "Ask" },
  { href: "/settings", label: "Settings" },
];

const WORKSPACE_NAMES: Record<string, string> = {
  "uk-landlord": "Whitmore portfolio",
  hospitality: "Hospitality demo",
  fleet: "Fleet demo",
  "generic-business": "Business demo",
};

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("t");
  const suffix = t ? `?t=${t}` : "";
  const workspaceName = WORKSPACE_NAMES[t ?? "uk-landlord"] ?? "Workspace";

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="border-b border-rule px-5 py-5">
        <div className="font-serif text-[26px] font-semibold leading-none tracking-wide text-ink">
          Castellan
        </div>
        <div className="mt-1.5 text-meta text-ink-muted">{workspaceName}</div>
      </div>
      <nav className="flex-1 px-2 py-3" aria-label="Primary">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={`${item.href}${suffix}`}
              aria-current={active ? "page" : undefined}
              className={`mb-0.5 block rounded-ctl px-3 py-2 text-table transition-colors ${
                active
                  ? "bg-brand-weak font-medium text-brand"
                  : "text-ink hover:bg-canvas"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-rule px-5 py-4 text-meta text-ink-muted">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
          Data in UK region
        </div>
        <div className="mt-1">Owner · MFA on</div>
      </div>
    </aside>
  );
}
