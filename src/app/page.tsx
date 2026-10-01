import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { getMembershipsForUser } from "@/server/context";
import { hasDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function Landing() {
  // Signed-in visitors go straight to their workspace (only when a DB is wired).
  let target: string | null = null;
  if (hasDatabase()) {
    try {
      const user = await currentUser();
      if (user) {
        const wss = await getMembershipsForUser(user.id);
        target = wss[0] ? `/w/${wss[0].slug}` : "/onboarding";
      }
    } catch {
      /* no DB / not signed in — show the landing */
    }
  }
  if (target) redirect(target);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-serif text-[26px] font-semibold tracking-wide text-ink">Castellan</span>
        <nav className="flex items-center gap-2">
          <Link href="/signin" className="rounded-ctl px-3 py-1.5 text-table text-ink hover:bg-surface">Sign in</Link>
          <Link href="/signup" className="rounded-ctl bg-brand px-3 py-1.5 text-table font-medium text-white hover:opacity-90">Create account</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="font-serif text-[44px] font-semibold leading-tight text-ink">
          Every great estate had a castellan.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-body text-ink-muted">
          Read every document once, turn it into dated obligations, and know exactly what needs
          doing today. For UK landlords and any organisation that tracks records, documents and
          deadlines — shaped around your own data.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {hasDatabase() ? (
            <>
              <Link href="/signup" className="rounded-ctl bg-brand px-5 py-2.5 text-body font-medium text-white hover:opacity-90">
                Create your workspace
              </Link>
              <Link href="/demo" className="rounded-ctl border border-rule bg-surface px-5 py-2.5 text-body text-ink hover:bg-canvas">
                See the demo
              </Link>
            </>
          ) : (
            <>
              <Link href="/demo" className="rounded-ctl bg-brand px-5 py-2.5 text-body font-medium text-white hover:opacity-90">
                Explore the demo
              </Link>
              <Link href="/signup" className="rounded-ctl border border-rule bg-surface px-5 py-2.5 text-body text-ink hover:bg-canvas">
                Accounts opening soon
              </Link>
            </>
          )}
        </div>

        <div className="mx-auto mt-16 grid max-w-2xl gap-4 text-left sm:grid-cols-3">
          {[
            ["Records & documents", "Define your own objects and fields; import a spreadsheet in minutes."],
            ["Dated obligations", "Rules turn trigger dates into reminders — nothing expires silently."],
            ["Today, every morning", "A single plan: what's overdue, due today, and good to start."],
          ].map(([h, b]) => (
            <div key={h} className="rounded-panel border border-rule bg-surface p-4">
              <div className="text-table font-medium text-ink">{h}</div>
              <p className="mt-1 text-meta text-ink-muted">{b}</p>
            </div>
          ))}
        </div>

        <p className="mt-16 text-meta text-ink-muted">Data held in the UK region · UK GDPR</p>
      </main>
    </div>
  );
}
