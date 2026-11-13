import Link from "next/link";
import { isResetTokenValid } from "@/server/accounts";
import { resetPasswordAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const valid = !sp.invalid && (await isResetTokenValid(token));

  if (!valid) {
    return (
      <div className="rounded-panel border border-rule bg-surface p-6">
        <h1 className="text-section font-semibold text-ink">This link has expired</h1>
        <p className="mt-2 text-body text-ink-muted">
          Reset links work once and expire after 60 minutes. Request a new one.
        </p>
        <p className="mt-4 text-table">
          <Link href="/forgot" className="font-medium text-brand hover:underline">Send a new link</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Choose a new password</h1>
      <p className="mt-1 text-meta text-ink-muted">You&apos;ll be signed out everywhere else.</p>
      {error && (
        <p role="alert" className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={resetPasswordAction} className="mt-4 space-y-3">
        <input type="hidden" name="token" value={token} />
        <label className="block">
          <span className="text-meta text-ink-muted">New password (at least 10 characters)</span>
          <input name="password" type="password" required minLength={10} autoComplete="new-password"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
        </label>
        <label className="block">
          <span className="text-meta text-ink-muted">Repeat the new password</span>
          <input name="confirm" type="password" required minLength={10} autoComplete="new-password"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
        </label>
        <SubmitButton pendingLabel="Saving…">Save password and sign in</SubmitButton>
      </form>
    </div>
  );
}
