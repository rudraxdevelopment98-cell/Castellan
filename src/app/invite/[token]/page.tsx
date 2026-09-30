import Link from "next/link";
import { currentUser } from "@/server/session";
import { acceptInviteAction } from "../../(platform)/actions";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const user = await currentUser();
  const next = `/invite/${token}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="font-serif text-[32px] font-semibold tracking-wide text-ink">Castellan</div>
          <p className="mt-1 text-meta text-ink-muted">You&apos;ve been invited to a workspace.</p>
        </div>
        <div className="rounded-panel border border-rule bg-surface p-6">
          {error && (
            <p className="mb-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</p>
          )}
          {user ? (
            <form action={acceptInviteAction} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <p className="text-body text-ink">Accept this invitation as <strong>{user.email}</strong>?</p>
              <button className="w-full rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white hover:opacity-90">
                Accept invitation
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-body text-ink-muted">Sign in or create an account to accept.</p>
              <Link href={`/signup?next=${encodeURIComponent(next)}`} className="block w-full rounded-ctl bg-brand px-3 py-2 text-center text-table font-medium text-white hover:opacity-90">
                Create an account
              </Link>
              <Link href={`/signin?next=${encodeURIComponent(next)}`} className="block w-full rounded-ctl border border-rule px-3 py-2 text-center text-table text-ink hover:bg-canvas">
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
