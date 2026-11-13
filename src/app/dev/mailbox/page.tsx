import { notFound } from "next/navigation";
import { devOutbox, emailConfigured } from "@/server/email/transport";

export const dynamic = "force-dynamic";

/**
 * Development only: messages captured because no email provider is configured.
 * Returns 404 in production or whenever a real provider is set.
 */
export default function DevMailbox() {
  if (process.env.NODE_ENV === "production" || emailConfigured()) notFound();
  const messages = [...devOutbox].reverse().slice(0, 20);
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-10">
      <h1 className="text-title font-semibold text-ink">Dev mailbox</h1>
      <p className="text-meta text-ink-muted">Newest first. Only exists while no email provider is configured.</p>
      {messages.length === 0 && <p className="text-body text-ink-muted">No messages yet.</p>}
      {messages.map((m, i) => (
        <article key={i} className="rounded-panel border border-rule bg-surface p-4">
          <div className="text-meta text-ink-muted">To {m.to} · {m.kind}</div>
          <div className="mt-1 text-table font-medium text-ink">{m.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap break-all text-meta text-ink">{m.text}</pre>
        </article>
      ))}
    </main>
  );
}
