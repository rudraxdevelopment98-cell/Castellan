import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { authTokens } from "./db/schema";
import { asService, type AnyPgDb } from "./db/client";
import { newToken, sha256 } from "./auth";

/**
 * Single-use, expiring tokens for links sent by email (AUDIT H5/H6). Only the
 * SHA-256 of a token is stored. Issuing a new token supersedes any unused one
 * of the same purpose, consuming is atomic (a token works exactly once even
 * under concurrent clicks), and issuing is rate-limited per user.
 */

/**
 * verify_email / password_reset: links sent by email.
 * mfa_pending: the half-way state between a correct password and a correct
 * second factor — never a session (AUDIT H7).
 */
export type TokenPurpose = "verify_email" | "password_reset" | "mfa_pending";

export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  verify_email: 24 * 60,
  password_reset: 60,
  mfa_pending: 10,
};

/** At most this many tokens of one purpose per user per hour. */
export const MAX_TOKENS_PER_HOUR = 5;
const LIMIT_PER_HOUR: Record<TokenPurpose, number> = {
  verify_email: MAX_TOKENS_PER_HOUR,
  password_reset: MAX_TOKENS_PER_HOUR,
  // Each password sign-in issues one; wrong codes are limited by account lockout.
  mfa_pending: 20,
};

export type IssueResult = { ok: true; token: string } | { ok: false; reason: "rate_limited" };

export async function issueToken(
  db: AnyPgDb,
  input: { userId: string; purpose: TokenPurpose; email: string },
): Promise<IssueResult> {
  return asService(db, async (tx) => {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(authTokens)
      .where(and(eq(authTokens.userId, input.userId), eq(authTokens.purpose, input.purpose), gt(authTokens.createdAt, hourAgo)));
    if (Number(n) >= LIMIT_PER_HOUR[input.purpose]) return { ok: false as const, reason: "rate_limited" as const };

    // Only the newest link of a purpose works.
    await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, input.userId), eq(authTokens.purpose, input.purpose), isNull(authTokens.usedAt)));

    const { token, tokenHash } = newToken();
    await tx.insert(authTokens).values({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash,
      email: input.email,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES[input.purpose] * 60_000),
    });
    return { ok: true as const, token };
  });
}

/** True if the token is currently valid, without using it (for showing a form). */
export async function peekToken(db: AnyPgDb, raw: string, purpose: TokenPurpose): Promise<boolean> {
  if (!raw) return false;
  return asService(db, async (tx) => {
    const [row] = await tx
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, sha256(raw)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return Boolean(row);
  });
}

/** Who a currently valid token belongs to, without using it up. */
export async function tokenOwner(db: AnyPgDb, raw: string, purpose: TokenPurpose): Promise<string | null> {
  if (!raw) return null;
  return asService(db, async (tx) => {
    const [row] = await tx
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, sha256(raw)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ? String(row.userId) : null;
  });
}

/** Use a token once. Returns who it belongs to, or null if invalid/used/expired. */
export async function consumeToken(
  db: AnyPgDb,
  raw: string,
  purpose: TokenPurpose,
  // Runs inside the same transaction, so the token is only spent if this succeeds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then?: (tx: any, owner: { userId: string; email: string }) => Promise<void>,
): Promise<{ userId: string; email: string } | null> {
  if (!raw) return null;
  return asService(db, async (tx) => {
    const [row] = await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, sha256(raw)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authTokens.userId, email: authTokens.email });
    if (!row) return null;
    const owner = { userId: String(row.userId), email: String(row.email) };
    if (then) await then(tx, owner);
    return owner;
  });
}
