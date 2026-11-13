import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { users } from "./db/schema";
import { asService, getDb } from "./db/client";
import { consumeRecoveryCode, newRecoveryCodes, newTotpSecret, totpKeyUri, LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from "./auth";

/**
 * Two-factor authentication with TOTP (AUDIT H7).
 *
 * Enrolment stores a secret that is not active until the user proves they can
 * generate codes from it; confirming switches MFA on and returns ten one-time
 * recovery codes (stored only as hashes). A code is accepted at most once: the
 * accepted time-step is recorded and anything at or before it is a replay.
 * Wrong codes count toward the same lockout as wrong passwords.
 */

const STEP_SECONDS = 30;
// Accept the previous and next 30-second step to allow for phone clock drift.
authenticator.options = { window: 1, step: STEP_SECONDS };

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export interface Enrolment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/** Start (or restart) enrolment: a fresh, not-yet-active secret. */
export async function beginEnrolment(userId: string): Promise<Enrolment> {
  const db = await getDb();
  const email = await asService(db, async (tx) => {
    const [u] = await tx.select({ email: users.email, on: users.mfaEnabled }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error("No such user");
    if (u.on) throw new Error("Two-factor sign-in is already on.");
    return String(u.email);
  });
  const secret = newTotpSecret();
  await asService(db, (tx) =>
    tx.update(users).set({ totpSecret: secret, totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, userId)),
  );
  const otpauthUri = totpKeyUri(email, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });
  return { secret, otpauthUri, qrDataUrl };
}

type CodeCheck = "ok" | "wrong" | "replayed" | "locked";

/**
 * Check a 6-digit code for a user, with replay protection and lockout. On "ok"
 * the step is recorded so the same code can never be used again.
 */
async function checkCode(userId: string, code: string, opts: { requireEnabled: boolean }): Promise<CodeCheck> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u?.totpSecret || (opts.requireEnabled && !u.mfaEnabled)) return "wrong";
    if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) return "locked";

    const cleaned = code.replace(/\s/g, "");
    let delta: number | null = null;
    try {
      delta = /^\d{6}$/.test(cleaned) ? authenticator.checkDelta(cleaned, u.totpSecret) : null;
    } catch {
      delta = null;
    }
    if (delta === null) {
      const failed = (u.failedLoginCount ?? 0) + 1;
      const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
      await tx.update(users).set({ failedLoginCount: lockedUntil ? 0 : failed, lockedUntil }).where(eq(users.id, userId));
      return "wrong";
    }
    const step = currentStep() + delta;
    if (u.totpLastStep !== null && step <= u.totpLastStep) return "replayed";
    await tx.update(users).set({ totpLastStep: step, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    return "ok";
  });
}

/** Finish enrolment with a code from the app. Returns the recovery codes, once. */
export async function confirmEnrolment(userId: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const res = await checkCode(userId, code, { requireEnabled: false });
  if (res === "locked") return { ok: false, error: "Too many wrong codes. Try again in a few minutes." };
  if (res !== "ok") return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
  const { plain, hashes } = newRecoveryCodes();
  const db = await getDb();
  await asService(db, (tx) =>
    tx.update(users).set({ mfaEnabled: true, recoveryCodes: hashes, updatedAt: new Date() }).where(eq(users.id, userId)),
  );
  return { ok: true, recoveryCodes: plain };
}

/** Second step of sign-in: an authenticator code or a recovery code. */
export async function verifySecondFactor(userId: string, input: string): Promise<{ ok: boolean; error?: string; usedRecoveryCode?: boolean }> {
  const value = input.trim();
  if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(value)) {
    const db = await getDb();
    return asService(db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u?.mfaEnabled) return { ok: false, error: "That code didn't work." };
      if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
      const r = consumeRecoveryCode(value, (u.recoveryCodes as string[] | null) ?? []);
      if (!r.ok) {
        const failed = (u.failedLoginCount ?? 0) + 1;
        const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
        await tx.update(users).set({ failedLoginCount: lockedUntil ? 0 : failed, lockedUntil }).where(eq(users.id, userId));
        return { ok: false, error: "That code didn't work." };
      }
      await tx.update(users).set({ recoveryCodes: r.remaining, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
      return { ok: true, usedRecoveryCode: true };
    });
  }
  const res = await checkCode(userId, value, { requireEnabled: true });
  if (res === "ok") return { ok: true };
  if (res === "locked") return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  if (res === "replayed") return { ok: false, error: "That code was already used. Wait for the next one." };
  return { ok: false, error: "That code didn't work." };
}

/** Turn MFA off; needs a current code (or a recovery code) to prove possession. */
export async function disableMfa(userId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const check = await verifySecondFactor(userId, code);
  if (!check.ok) return check;
  const db = await getDb();
  await asService(db, (tx) =>
    tx
      .update(users)
      .set({ mfaEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null, updatedAt: new Date() })
      .where(eq(users.id, userId)),
  );
  return { ok: true };
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [u] = await tx.select({ c: users.recoveryCodes }).from(users).where(eq(users.id, userId)).limit(1);
    return ((u?.c as string[] | null) ?? []).length;
  });
}
