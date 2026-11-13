import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "./db/schema";
import { asService, getDb } from "./db/client";
import {
  hashPassword,
  verifyPassword,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
} from "./auth";

/**
 * User accounts (global, not tenant-scoped). Argon2id passwords, brute-force
 * lockout (spec authentication_must). Public sign-up goes through
 * accounts.startSignUp, which emails a verification link; an account cannot
 * sign in until its address is verified (AUDIT H5).
 */

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
  emailVerified: boolean;
}

function toPublic(u: {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
  emailVerifiedAt: Date | string | null;
}): PublicUser {
  return { id: u.id, email: u.email, name: u.name, mfaEnabled: u.mfaEnabled, emailVerified: Boolean(u.emailVerifiedAt) };
}

const normEmail = (email: string) => email.trim().toLowerCase();

/**
 * Create an account directly. Not the public sign-up path (that is
 * accounts.startSignUp, which never reveals whether an email exists); used by
 * tests and internal tooling. Accounts start unverified unless stated.
 */
export async function createUser(
  input: { email: string; password: string; name: string },
  opts: { emailVerified?: boolean } = {},
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const db = await getDb();
  const email = normEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const emailVerifiedAt = opts.emailVerified ? new Date() : null;
  try {
    return await asService(db, async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing[0]) return { ok: false as const, error: "That email is already registered." };
      const [u] = await tx
        .insert(users)
        .values({ email, name: input.name, passwordHash, emailVerifiedAt })
        .returning();
      return { ok: true as const, user: toPublic(u) };
    });
  } catch {
    return { ok: false, error: "Could not create the account." };
  }
}

export async function findUserByEmail(email: string): Promise<PublicUser | null> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, normEmail(email))).limit(1);
    return u ? toPublic(u) : null;
  });
}

export type LoginResult =
  | { ok: true; user: PublicUser; mfaRequired: boolean }
  | { ok: false; error: string };

/**
 * One message for every failed sign-in — unknown email, wrong password or a
 * locked account — so the response never reveals whether an address is
 * registered (AUDIT H11). It still tells a real user about the lockout.
 */
export const UNVERIFIED_MESSAGE =
  "Please confirm your email address first — use the link we emailed you. Lost it? Use “Forgot password” to get a new one.";

export const LOGIN_FAILED_MESSAGE =
  `Email or password is incorrect. After ${MAX_FAILED_LOGINS} failed attempts an account is locked for ${LOCKOUT_MINUTES} minutes.`;

// A real Argon2id hash of a random value, computed once. Verifying against it
// when the account is missing (or locked) makes those paths cost the same as a
// genuine wrong-password check, closing the timing side channel.
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}

/** Verify credentials with lockout accounting. Does not create a session. */
export async function verifyLogin(input: {
  email: string;
  password: string;
}): Promise<LoginResult> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, normEmail(input.email))).limit(1);
    const generic = { ok: false as const, error: LOGIN_FAILED_MESSAGE };

    const locked = Boolean(u?.lockedUntil && new Date(u.lockedUntil) > new Date());
    if (!u || !u.passwordHash || locked) {
      // Burn the same work as a real check, then fail identically.
      await verifyPassword(await getDummyHash(), input.password);
      return generic;
    }

    const good = await verifyPassword(u.passwordHash, input.password);
    if (!good) {
      const failed = (u.failedLoginCount ?? 0) + 1;
      const lockedUntil =
        failed >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null;
      await tx
        .update(users)
        .set({ failedLoginCount: lockedUntil ? 0 : failed, lockedUntil })
        .where(eq(users.id, u.id));
      return generic;
    }

    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
    // Only someone who knows the password learns the account is unverified, so
    // this does not reopen the enumeration channel.
    if (!u.emailVerifiedAt) return { ok: false as const, error: UNVERIFIED_MESSAGE };
    return { ok: true as const, user: toPublic(u), mfaRequired: u.mfaEnabled };
  });
}
