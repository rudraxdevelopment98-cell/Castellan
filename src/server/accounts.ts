import { and, eq, gt, sql } from "drizzle-orm";
import { emailDeliveries, sessions, users } from "./db/schema";
import { asService, getDb } from "./db/client";
import { hashPassword } from "./auth";
import { consumeToken, issueToken, peekToken } from "./authTokens";
import { absoluteUrl } from "./appUrl";
import { sendEmail } from "./email/transport";
import * as templates from "./email/templates";

/**
 * Account email flows (AUDIT H5, H6): sign-up with email verification and
 * password reset.
 *
 * Sign-up never reveals whether an address is registered: a new address gets a
 * verification link; an existing one gets an "account exists" email with sign-in
 * and reset links, and the screen is identical either way. Signing up again on
 * an existing address never changes its password — that is what stops someone
 * pre-registering a victim's email with a password they know. Unverified
 * accounts cannot sign in (see users.verifyLogin); the verification link signs
 * the user in, and a completed password reset also proves the address.
 */

const normEmail = (email: string) => email.trim().toLowerCase();

/** Hold an outcome to a minimum duration so its timing does not leak a branch. */
export async function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const [res] = await Promise.all([work, new Promise((r) => setTimeout(r, ms))]);
  return res;
}

async function recentDeliveries(kind: string, to: string): Promise<number> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.kind, kind), eq(emailDeliveries.toEmail, to), gt(emailDeliveries.createdAt, new Date(Date.now() - 3600_000))));
    return Number(n);
  });
}

export async function startSignUp(
  input: { name: string; email: string; password: string },
  /** A same-site path to land on after verifying (already validated by the caller). */
  next?: string | null,
): Promise<void> {
  const db = await getDb();
  const email = normEmail(input.email);
  // Always pay for the hash, so a new and an existing address cost the same.
  const passwordHash = await hashPassword(input.password);

  const created = await asService(db, async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return null;
    const [u] = await tx
      .insert(users)
      .values({ email, name: input.name, passwordHash, emailVerifiedAt: null })
      .onConflictDoNothing()
      .returning({ id: users.id });
    return u ? String(u.id) : null;
  });

  if (created) {
    const t = await issueToken(db, { userId: created, purpose: "verify_email", email });
    if (t.ok) {
      const path = `/verify/${t.token}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      const msg = templates.verifyEmail(absoluteUrl(path), input.name);
      await sendEmail({ kind: "verify_email", to: email, userId: created, ...msg });
    }
    return;
  }

  // Existing address: tell its owner, at most 3 times an hour.
  if ((await recentDeliveries("account_exists", email)) < 3) {
    const msg = templates.accountExists(absoluteUrl("/signin"), absoluteUrl("/forgot"));
    await sendEmail({ kind: "account_exists", to: email, ...msg });
  }
}

/** Send a fresh verification link to a signed-in but unverified user. */
export async function resendVerification(user: { id: string; email: string; name: string | null }): Promise<"sent" | "rate_limited" | "failed"> {
  const db = await getDb();
  const t = await issueToken(db, { userId: user.id, purpose: "verify_email", email: user.email });
  if (!t.ok) return "rate_limited";
  const res = await sendEmail({
    kind: "verify_email",
    to: user.email,
    userId: user.id,
    ...templates.verifyEmail(absoluteUrl(`/verify/${t.token}`), user.name),
  });
  return res.ok ? "sent" : "failed";
}

export const isVerifyTokenValid = async (token: string) => peekToken(await getDb(), token, "verify_email");
export const isResetTokenValid = async (token: string) => peekToken(await getDb(), token, "password_reset");

/** Mark the address verified. Returns the user id to sign in, or null. */
export async function confirmEmail(token: string): Promise<string | null> {
  const db = await getDb();
  const owner = await consumeToken(db, token, "verify_email", async (tx, o) => {
    // Only if the account still has the address the link was sent to.
    await tx
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, o.userId), eq(users.email, o.email)));
  });
  if (!owner) return null;
  const verified = await asService(db, async (tx) => {
    const [u] = await tx.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, owner.userId)).limit(1);
    return Boolean(u?.v);
  });
  return verified ? owner.userId : null;
}

/** Always resolves the same way; sends a link only when the account exists. */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const db = await getDb();
  const email = normEmail(rawEmail);
  const userId = await asService(db, async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return u ? String(u.id) : null;
  });
  if (!userId) return;
  const t = await issueToken(db, { userId, purpose: "password_reset", email });
  if (!t.ok) return; // rate limited — silently, to stay uniform
  await sendEmail({
    kind: "password_reset",
    to: email,
    userId,
    ...templates.passwordReset(absoluteUrl(`/reset/${t.token}`)),
  });
}

/**
 * Set a new password from a reset link. Clears any lockout, proves the address,
 * and signs out every existing session. Returns the user id, or null if the
 * link is invalid, used or expired.
 */
export async function completePasswordReset(token: string, newPassword: string): Promise<string | null> {
  const db = await getDb();
  const passwordHash = await hashPassword(newPassword);
  const owner = await consumeToken(db, token, "password_reset", async (tx, o) => {
    await tx
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, o.userId));
    await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, o.userId), eq(users.email, o.email), sql`${users.emailVerifiedAt} is null`));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, o.userId), sql`${sessions.revokedAt} is null`));
  });
  if (!owner) return null;
  await sendEmail({
    kind: "password_changed",
    to: owner.email,
    userId: owner.userId,
    ...templates.passwordChanged(absoluteUrl("/forgot")),
  });
  return owner.userId;
}
