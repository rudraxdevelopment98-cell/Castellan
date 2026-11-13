"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { beginEnrolment, confirmEnrolment, disableMfa } from "@/server/mfa";

export async function startMfaAction(): Promise<void> {
  const user = await requireUser("/account/security");
  if (!user.mfaEnabled) await beginEnrolment(user.id);
  redirect("/account/security");
}

export type ConfirmState = { error?: string; recoveryCodes?: string[] };

/**
 * Returns the recovery codes to the page that submitted the form, so they are
 * shown exactly once and never travel in a URL.
 */
export async function confirmMfaAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const user = await requireUser("/account/security");
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")) : "";
  const res = await confirmEnrolment(user.id, code);
  return res.ok ? { recoveryCodes: res.recoveryCodes } : { error: res.error };
}

export async function disableMfaAction(formData: FormData): Promise<void> {
  const user = await requireUser("/account/security");
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")) : "";
  const res = await disableMfa(user.id, code);
  redirect(res.ok ? "/account/security?off=1" : `/account/security?error=${encodeURIComponent(res.error ?? "That code didn't work.")}`);
}
