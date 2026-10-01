"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for server-action forms. Uses useFormStatus so the moment the
 * form is submitting it disables itself and shows a pending label — giving the
 * user immediate feedback and preventing the double-clicks that happen when a
 * button looks dead while an action is in flight.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        className ??
        "w-full rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
