/**
 * Shown instantly while a workspace page loads, so a click always gets a visible
 * response — even when the data takes a moment to arrive.
 */
export default function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 rounded-ctl bg-rule" />
      <div className="mt-3 h-4 w-72 max-w-full rounded-ctl bg-rule" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-ctl border border-rule bg-surface" />
        ))}
      </div>
    </div>
  );
}
