import Link from "next/link";
import { signUpAction } from "../actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "";

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Create your account</h1>
      {error && (
        <p className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={signUpAction} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="text-meta text-ink-muted">Your name</span>
          <input
            name="name"
            required
            autoComplete="name"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
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
        <label className="block">
          <span className="text-meta text-ink-muted">Password (at least 10 characters)</span>
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
        <button className="w-full rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white hover:opacity-90">
          Create account
        </button>
      </form>
      <p className="mt-4 text-meta text-ink-muted">
        Already have an account?{" "}
        <Link href="/signin" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
