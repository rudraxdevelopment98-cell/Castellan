import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, resolveSession, revokeSession } from "./sessionStore";
import { SESSION_DEFAULT_HOURS } from "./auth";
import type { PublicUser } from "./users";

/**
 * Cookie glue over the session store. The raw token lives in an httpOnly,
 * SameSite=Lax cookie; the DB stores only its hash. Node runtime only.
 */

const COOKIE = "cstl_session";

export async function startSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const { token } = await createSession(userId, meta);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DEFAULT_HOURS * 60 * 60,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const resolved = await resolveSession(token);
  return resolved?.user ?? null;
}

/** Require a signed-in user or redirect to sign-in (optionally returning here). */
export async function requireUser(returnTo?: string): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) {
    redirect(returnTo ? `/signin?next=${encodeURIComponent(returnTo)}` : "/signin");
  }
  return user;
}
