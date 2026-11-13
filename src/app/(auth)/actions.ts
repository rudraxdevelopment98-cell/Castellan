"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getDb } from "@/server/db/client";
import { consumeToken, issueToken, tokenOwner } from "@/server/authTokens";
import { verifySecondFactor } from "@/server/mfa";
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
    // Password is right; no session until the second factor is too (AUDIT H7).
    const t = await issueToken(await getDb(), { userId: res.user.id, purpose: "mfa_pending", email: res.user.email });
    if (!t.ok) redirect(`/signin?error=${encodeURIComponent("Too many sign-in attempts. Try again later.")}`);
    (await cookies()).set(MFA_COOKIE, t.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    redirect(`/signin/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  await startSession(res.user.id, await meta());
  redirect(await destinationFor(res.user.id, next));
}

const MFA_COOKIE = "cstl_mfa";

/** Second sign-in step: an authenticator code or a recovery code. */
export async function mfaSignInAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const back = (msg: string) =>
    redirect(`/signin/mfa?error=${encodeURIComponent(msg)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  const jar = await cookies();
  const pending = jar.get(MFA_COOKIE)?.value ?? "";
  const db = await getDb();
  const userId = await tokenOwner(db, pending, "mfa_pending");
  if (!userId) {
    jar.delete(MFA_COOKIE);
    redirect(`/signin?error=${encodeURIComponent("Your sign-in timed out. Please enter your password again.")}`);
  }
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")) : "";
  const check = await verifySecondFactor(userId, code);
  if (!check.ok) back(check.error ?? "That code didn't work.");
  // Spend the pending token; if it was already used, start again.
  if (!(await consumeToken(db, pending, "mfa_pending"))) {
    redirect(`/signin?error=${encodeURIComponent("Your sign-in timed out. Please enter your password again.")}`);
  }
  jar.delete(MFA_COOKIE);
  await startSession(userId, { ...(await meta()), mfaSatisfied: true });
  redirect(await destinationFor(userId, next));
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
