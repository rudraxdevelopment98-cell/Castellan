import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";

/**
 * The v1 demo shell (Today, Records, Compliance, …). It keeps its own sidebar
 * layout, separate from the v2 auth/workspace screens. Phase 3 re-bases these
 * screens onto the metadata engine and multi-tenant data.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden md:flex">
        <Suspense fallback={<div className="w-56 border-r border-rule bg-surface" />}>
          <Sidebar />
        </Suspense>
      </div>
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
