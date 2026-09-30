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
 * lockout (spec authentication_must). Email verification is auto-completed in
 * local dev; in production a verification email gates workspace creation.
 */

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
}

function toPublic(u: {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
}): PublicUser {
  return { id: u.id, email: u.email, name: u.name, mfaEnabled: u.mfaEnabled };
}

const normEmail = (email: string) => email.trim().toLowerCase();

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const db = await getDb();
  const email = normEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  // Auto-verify in dev; production flips this to a verification email.
  const emailVerifiedAt = process.env.DATABASE_URL ? null : new Date();
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

/** Verify credentials with lockout accounting. Does not create a session. */
export async function verifyLogin(input: {
  email: string;
  password: string;
}): Promise<LoginResult> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, normEmail(input.email))).limit(1);
    // Uniform failure message to avoid leaking which emails exist.
    const generic = { ok: false as const, error: "Email or password is incorrect." };
    if (!u || !u.passwordHash) return generic;

    if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) {
      return { ok: false as const, error: "Account temporarily locked. Try again later." };
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
    return { ok: true as const, user: toPublic(u), mfaRequired: u.mfaEnabled };
  });
}
