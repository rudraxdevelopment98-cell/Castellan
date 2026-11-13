"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** Workspace sidebar navigation with active-state highlighting. */
export function WorkspaceNav({ items, slug }: { items: NavItem[]; slug: string }) {
  const pathname = usePathname();
  const home = `/w/${slug}`;
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Workspace">
      {items.map((item) => {
        const active = item.href === home ? pathname === home : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-ctl px-3 py-2 text-table transition-colors ${
              active ? "bg-brand-weak font-medium text-brand" : "text-ink hover:bg-canvas"
            }`}
          >
            {item.label}
            <PendingDot />
          </Link>
        );
      })}
    </nav>
  );
}

/** A small pulsing dot on the link that was just clicked, until its page shows. */
function PendingDot() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span aria-hidden className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand align-middle" />
  ) : null;
}
