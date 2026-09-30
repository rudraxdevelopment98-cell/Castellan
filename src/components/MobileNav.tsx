"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Mobile bottom bar (spec ui_ux.layout.mobile): Today, Documents, Records, Ask.
const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/documents", label: "Docs" },
  { href: "/records", label: "Records" },
  { href: "/ask", label: "Ask" },
];

export function MobileNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("t");
  const suffix = t ? `?t=${t}` : "";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-rule bg-surface md:hidden"
      aria-label="Primary mobile"
    >
      {ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-meta ${
              active ? "font-medium text-brand" : "text-ink-muted"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
