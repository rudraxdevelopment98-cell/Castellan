import Link from "next/link";

/** Shown on auth pages in production before a database is connected. */
export function ComingSoon() {
  return (
    <div className="rounded-panel border border-rule bg-surface p-6 text-center">
      <h1 className="text-section font-semibold text-ink">Accounts are opening soon</h1>
      <p className="mt-2 text-body text-ink-muted">
        We&apos;re finishing setup. In the meantime you can explore the full product with sample data.
      </p>
      <Link
        href="/demo"
        className="mt-4 inline-block rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90"
      >
        Explore the demo
      </Link>
    </div>
  );
}
