import Link from "next/link";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { requireUser } from "@/server/session";
import { getMembershipsForUser } from "@/server/context";
import { asService, getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { totpKeyUri } from "@/server/auth";
import { recoveryCodesLeft } from "@/server/mfa";
import { SubmitButton } from "@/components/SubmitButton";
import { startMfaAction, disableMfaAction } from "../actions";
import { ConfirmMfa } from "./ConfirmMfa";

export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/account/security");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const db = await getDb();
  const secret = await asService(db, async (tx) => {
    const [u] = await tx.select({ s: users.totpSecret }).from(users).where(eq(users.id, user.id)).limit(1);
    return (u?.s as string | null) ?? null;
  });
  const enrolling = !user.mfaEnabled && Boolean(secret);
  const qr = enrolling ? await QRCode.toDataURL(totpKeyUri(user.email, secret!), { margin: 1, width: 220 }) : null;
  const left = user.mfaEnabled ? await recoveryCodesLeft(user.id) : 0;
  const home = (await getMembershipsForUser(user.id))[0];

  return (
    <div className="flex min-h-screen items-start justify-center bg-canvas px-4 py-10">
      <main className="w-full max-w-md space-y-4">
        <Link href={home ? `/w/${home.slug}` : "/onboarding"} className="text-meta text-ink-muted hover:underline">← Back</Link>
        <div className="rounded-panel border border-rule bg-surface p-6">
          <h1 className="text-section font-semibold text-ink">Two-factor sign-in</h1>
          <p className="mt-1 text-meta text-ink-muted">
            Signed in as {user.email}. With two-factor sign-in, a stolen password alone can&apos;t open your account.
          </p>
          {sp.required && !user.mfaEnabled && (
            <p role="status" className="mt-3 rounded-ctl border border-rule bg-canvas px-3 py-2 text-meta text-ink">
              Your workspace requires two-factor sign-in. Set it up to continue.
            </p>
          )}
          {sp.off && <p role="status" className="mt-3 text-meta text-ink">Two-factor sign-in is off.</p>}
          {error && (
            <p role="alert" className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</p>
          )}

          <div className="mt-4 space-y-4">
            {user.mfaEnabled ? (
              <>
                <p className="text-body text-ink">
                  <strong>On.</strong> {left} recovery code{left === 1 ? "" : "s"} left.
                </p>
                <form action={disableMfaAction} className="space-y-3 border-t border-rule pt-4">
                  <label className="block">
                    <span className="text-meta text-ink-muted">To turn it off, enter a current code or a recovery code</span>
                    <input id="disable-code" name="code" required autoComplete="one-time-code" maxLength={11}
                      className="tnum mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
                  </label>
                  <SubmitButton pendingLabel="Turning off…" className="w-full rounded-ctl border border-rule px-3 py-2 text-table font-medium text-ink hover:bg-canvas disabled:opacity-60">
                    Turn off two-factor sign-in
                  </SubmitButton>
                </form>
              </>
            ) : enrolling ? (
              <>
                <ol className="list-decimal space-y-2 pl-5 text-body text-ink">
                  <li>Open Google Authenticator, Microsoft Authenticator or Authy on your phone.</li>
                  <li>Scan this code, or type the key below.</li>
                  <li>Enter the 6-digit code it shows.</li>
                </ol>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr!} alt="QR code to add Castellan to your authenticator app" width={220} height={220} className="mx-auto rounded-ctl border border-rule bg-white p-2" />
                <p className="break-all rounded-ctl bg-canvas px-3 py-2 text-center font-mono text-table text-ink">{secret}</p>
                <ConfirmMfa />
              </>
            ) : (
              <form action={startMfaAction}>
                <SubmitButton pendingLabel="Preparing…">Set up two-factor sign-in</SubmitButton>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
