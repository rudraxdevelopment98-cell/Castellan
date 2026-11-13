"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { emailSchema, parseSignInForm, parseSignUpForm, passwordSchema } from "@/server/validation";
import { verifyLogin } from "@/server/users";
import { getMembershipsForUser } from "@/server/context";
import { startSession, endSession, requireUser } from "@/server/session";
import {
  atLeast,
  completePasswordReset,
  confirmEmail,
  requestPasswordReset,
  resendVerification,
  startSignUp,
} from "@/server/accounts";

/** Responses on the public email flows take at least this long, whatever happened. */
const UNIFORM_MS = 1200;

function safeNext(next: FormDataEntryValue | null): string | null {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}

async function meta() {
  const h = await headers();
  return { userAgent: h.get("user-agent") ?? undefined, ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() };
}

async function destinationFor(userId: string, next: string | null): Promise<string> {
  if (next) return next;
  const wss = await getMembershipsForUser(userId);
  return wss[0] ? `/w/${wss[0].slug}` : "/onboarding";
}

/**
 * Sign-up never starts a session and never says whether the email is taken
 * (AUDIT H5/H11): every valid submission lands on the same "check your email"
 * screen after the same delay. The emailed link signs the user in.
 */
export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = parseSignUpForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Check your details.";
    redirect(`/signup?error=${encodeURIComponent(msg)}`);
  }
  const next = safeNext(formData.get("next"));
  await atLeast(
    UNIFORM_MS,
    startSignUp(parsed.data, next).catch((e) => console.error("sign-up failed:", e instanceof Error ? e.message : e)),
  );
  redirect("/check-email");
}

export async function signInAction(formData: FormData): Promise<void> {
  const parsed = parseSignInForm(formData);
  const next = safeNext(formData.get("next"));
  if (!parsed.success) {
    redirect(`/signin?error=${encodeURIComponent("Check your details.")}`);
  }
  const res = await verifyLogin({ email: parsed.data.email, password: parsed.data.password });
  if (!res.ok) {
    const q = new URLSearchParams({ error: res.error, email: parsed.data.email });
    if (next) q.set("next", next);
    redirect(`/signin?${q.toString()}`);
  }
  if (res.mfaRequired) {
    // TOTP sign-in UI lands in the next step; no account enables MFA yet.
    redirect(`/signin?error=${encodeURIComponent("MFA is enabled on this account; the MFA sign-in step is coming next.")}`);
  }
  await startSession(res.user.id, await meta());
  redirect(await destinationFor(res.user.id, next));
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/signin");
}

/** Second step of the emailed verification link (a button, so link scanners can't spend it). */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const next = safeNext(formData.get("next"));
  const userId = await confirmEmail(token);
  if (!userId) redirect(`/verify/${encodeURIComponent(token)}?error=1`);
  await startSession(userId, await meta());
  redirect(await destinationFor(userId, next));
}

/** For a signed-in account that predates verification or lost its link. */
export async function resendVerificationAction(): Promise<void> {
  const user = await requireUser("/onboarding");
  if (user.emailVerified) redirect("/onboarding");
  const outcome = await resendVerification(user);
  redirect(`/onboarding?verify=${outcome}`);
}

export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const email = emailSchema.safeParse(typeof formData.get("email") === "string" ? formData.get("email") : "");
  if (!email.success) redirect(`/forgot?error=${encodeURIComponent("Enter a valid email address.")}`);
  await atLeast(
    UNIFORM_MS,
    requestPasswordReset(email.data).catch((e) => console.error("reset request failed:", e instanceof Error ? e.message : e)),
  );
  redirect("/forgot?sent=1");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
  const confirm = typeof formData.get("confirm") === "string" ? String(formData.get("confirm")) : "";
  const back = (msg: string) => redirect(`/reset/${encodeURIComponent(token)}?error=${encodeURIComponent(msg)}`);

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Choose a longer password.");
  if (password !== confirm) back("The two passwords don't match.");

  const userId = await completePasswordReset(token, password);
  if (!userId) redirect(`/reset/${encodeURIComponent(token)}?invalid=1`);
  // Every earlier session was revoked; this device gets a fresh one.
  await startSession(userId, await meta());
  redirect(await destinationFor(userId, null));
}
