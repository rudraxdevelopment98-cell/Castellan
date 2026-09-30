"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInSchema, signUpSchema } from "@/server/validation";
import { createUser, verifyLogin } from "@/server/users";
import { getMembershipsForUser } from "@/server/context";
import { startSession, endSession } from "@/server/session";

function safeNext(next: FormDataEntryValue | null): string | null {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : null;
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

export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Check your details.";
    redirect(`/signup?error=${encodeURIComponent(msg)}`);
  }
  const res = await createUser(parsed.data);
  const next = safeNext(formData.get("next"));
  if (!res.ok) {
    const q = new URLSearchParams({ error: res.error });
    if (next) q.set("next", next);
    redirect(`/signup?${q.toString()}`);
  }
  await startSession(res.user.id, await meta());
  redirect(next ?? "/onboarding");
}

export async function signInAction(formData: FormData): Promise<void> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    totp: formData.get("totp"),
  });
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
