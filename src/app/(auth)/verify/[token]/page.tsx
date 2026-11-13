import Link from "next/link";
import { isVerifyTokenValid } from "@/server/accounts";
import { confirmEmailAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The emailed verification link lands here. Confirming needs a click, because
 * email security scanners fetch links on their own and would otherwise use up
 * the single-use token before the person ever sees it.
 */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  const valid = !sp.error && (await isVerifyTokenValid(token));

  if (!valid) {
    return (
      <div className="rounded-panel border border-rule bg-surface p-6">
        <h1 className="text-section font-semibold text-ink">This link has expired</h1>
        <p className="mt-2 text-body text-ink-muted">
          Verification links work once and expire after 24 hours. Sign in to get a new one, or use
          “Forgot password” — that also confirms your email.
        </p>
        <div className="mt-4 flex gap-3 text-table">
          <Link href="/signin" className="font-medium text-brand hover:underline">Sign in</Link>
          <Link href="/forgot" className="font-medium text-brand hover:underline">Forgot password</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Confirm your email</h1>
      <p className="mt-2 text-body text-ink-muted">One click and you&apos;re in.</p>
      <form action={confirmEmailAction} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <SubmitButton pendingLabel="Confirming…">Confirm email and continue</SubmitButton>
      </form>
    </div>
  );
}
