import Link from "next/link";
import { signInAction } from "../actions";
import { hasDatabase } from "@/server/db/client";
import { ComingSoon } from "@/components/ComingSoon";
import { SubmitButton } from "@/components/SubmitButton";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDatabase()) return <ComingSoon />;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const email = typeof sp.email === "string" ? sp.email : "";
  const next = typeof sp.next === "string" ? sp.next : "";

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Sign in</h1>
      {error && (
        <p className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={signInAction} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="text-meta text-ink-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            defaultValue={email}
            autoComplete="email"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
        <label className="block">
          <span className="text-meta text-ink-muted">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>
      <p className="mt-4 text-meta text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
