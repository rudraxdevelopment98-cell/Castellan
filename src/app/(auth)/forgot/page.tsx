import Link from "next/link";
import { forgotPasswordAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { emailConfigured } from "@/server/email/transport";

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const devMailbox = process.env.NODE_ENV !== "production" && !emailConfigured();

  if (sp.sent) {
    return (
      <div className="rounded-panel border border-rule bg-surface p-6">
        <h1 className="text-section font-semibold text-ink">Check your email</h1>
        <p className="mt-2 text-body text-ink-muted">
          If an account uses that address, we&apos;ve sent it a link to choose a new password. The link works
          once and expires in 60 minutes.
        </p>
        {devMailbox && (
          <p className="mt-4 text-meta text-ink">
            Development: <Link href="/dev/mailbox" className="font-medium text-brand underline">open the dev mailbox</Link>.
          </p>
        )}
        <p className="mt-4 text-meta">
          <Link href="/signin" className="font-medium text-brand hover:underline">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-meta text-ink-muted">We&apos;ll email you a link to choose a new one.</p>
      {error && (
        <p role="alert" className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={forgotPasswordAction} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-meta text-ink-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
        <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      </form>
      <p className="mt-4 text-meta text-ink-muted">
        <Link href="/signin" className="font-medium text-brand hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
