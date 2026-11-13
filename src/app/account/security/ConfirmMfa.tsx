"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { confirmMfaAction, type ConfirmState } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export function ConfirmMfa() {
  const [state, action] = useActionState<ConfirmState, FormData>(confirmMfaAction, {});
  const router = useRouter();

  if (state.recoveryCodes) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-ctl border border-ok/40 bg-ok/10 px-3 py-2 text-meta text-ok">
          Two-factor sign-in is on.
        </p>
        <p className="text-body text-ink">
          Save these recovery codes somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.
        </p>
        <ul className="tnum grid grid-cols-2 gap-2 rounded-ctl border border-rule bg-canvas p-3 font-mono text-table text-ink">
          {state.recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white hover:opacity-90"
        >
          I&apos;ve saved them
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <p role="alert" className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{state.error}</p>
      )}
      <label className="block">
        <span className="text-meta text-ink-muted">Code from the app</span>
        <input id="confirm-code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
          className="tnum mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body tracking-widest text-ink" />
      </label>
      <SubmitButton pendingLabel="Checking…">Turn on two-factor sign-in</SubmitButton>
    </form>
  );
}
