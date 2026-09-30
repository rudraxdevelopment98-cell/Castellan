import { and, eq, gt, isNull, desc } from "drizzle-orm";
import { sessions, users } from "./db/schema";
import { asService, getDb } from "./db/client";
import { newToken, sha256, SESSION_DEFAULT_HOURS } from "./auth";
import type { PublicUser } from "./users";

/**
 * Session store (global). Only the SHA-256 of the token is persisted; the raw
 * token lives in an httpOnly cookie. Sessions expire and can be revoked; the
 * privilege-change rotation and device list from the spec build on these.
 */

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string; mfaSatisfied?: boolean } = {},
): Promise<{ token: string; sessionId: string }> {
  const db = await getDb();
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DEFAULT_HOURS * 60 * 60 * 1000);
  return asService(db, async (tx) => {
    const [s] = await tx
      .insert(sessions)
      .values({
        userId,
        tokenHash,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        mfaSatisfied: meta.mfaSatisfied ?? false,
        expiresAt,
      })
      .returning({ id: sessions.id });
    return { token, sessionId: s.id as string };
  });
}

export interface ResolvedSession {
  sessionId: string;
  user: PublicUser;
}

export async function resolveSession(rawToken: string): Promise<ResolvedSession | null> {
  if (!rawToken) return null;
  const db = await getDb();
  const tokenHash = sha256(rawToken);
  return asService(db, async (tx) => {
    const rows = await tx
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        mfaEnabled: users.mfaEnabled,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    // Touch last-seen (best-effort).
    await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, r.sessionId));
    return {
      sessionId: r.sessionId as string,
      user: { id: r.userId as string, email: r.email as string, name: r.name, mfaEnabled: r.mfaEnabled as boolean },
    };
  });
}

export async function revokeSession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const db = await getDb();
  const tokenHash = sha256(rawToken);
  await asService(db, async (tx) => {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
  });
}

export async function listSessionsForUser(userId: string) {
  const db = await getDb();
  return asService(db, async (tx) =>
    tx
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.lastSeenAt)),
  );
}
