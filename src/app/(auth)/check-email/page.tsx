import Link from "next/link";
import { emailConfigured } from "@/server/email/transport";

export default function CheckEmailPage() {
  const devMailbox = process.env.NODE_ENV !== "production" && !emailConfigured();
  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Check your email</h1>
      <p className="mt-2 text-body text-ink-muted">
        If that address can be used for a new account, we&apos;ve sent it a link to confirm it. Open the link
        to finish signing up — it works once and expires in 24 hours.
      </p>
      <p className="mt-3 text-meta text-ink-muted">
        Already have an account? We&apos;ve emailed that address a sign-in link instead.
      </p>
      {devMailbox && (
        <p className="mt-4 rounded-ctl border border-rule bg-canvas px-3 py-2 text-meta text-ink">
          Development: no email provider is configured.{" "}
          <Link href="/dev/mailbox" className="font-medium text-brand underline">
            Open the dev mailbox
          </Link>
          .
        </p>
      )}
      <p className="mt-4 text-meta text-ink-muted">
        <Link href="/signin" className="font-medium text-brand hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
