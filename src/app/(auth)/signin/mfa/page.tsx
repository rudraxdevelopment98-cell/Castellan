import Link from "next/link";
import { mfaSignInAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "";
  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Two-factor sign-in</h1>
      <p className="mt-1 text-meta text-ink-muted">
        Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={mfaSignInAction} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="text-meta text-ink-muted">Code</span>
          <input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={11}
            placeholder="123456"
            className="tnum mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body tracking-widest text-ink"
          />
        </label>
        <SubmitButton pendingLabel="Checking…">Verify and sign in</SubmitButton>
      </form>
      <p className="mt-4 text-meta">
        <Link href="/signin" className="font-medium text-brand hover:underline">Start again</Link>
      </p>
    </div>
  );
}
