import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { authenticator } from "otplib";

/**
 * Auth primitives (spec authentication_must). Argon2id password hashing,
 * opaque session/invite tokens stored only as SHA-256, TOTP MFA and recovery
 * codes. No secrets are logged; raw tokens live only in the caller's hand.
 */

// OWASP-aligned Argon2id parameters.
const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Create an opaque token; return the raw value (given out once) and its hash. */
export function newToken(bytes = 32): { token: string; tokenHash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time compare of a presented token against a stored hash. */
export function tokenMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- MFA (TOTP) -------------------------------------------------------------

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(email: string, secret: string, issuer = "Castellan"): string {
  return authenticator.keyuri(email, issuer, secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

// --- Recovery codes ---------------------------------------------------------

export function newRecoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { plain, hashes: plain.map((c) => sha256(c)) };
}

export function consumeRecoveryCode(
  presented: string,
  hashes: string[],
): { ok: boolean; remaining: string[] } {
  const h = sha256(presented.trim().toLowerCase());
  const idx = hashes.indexOf(h);
  if (idx === -1) return { ok: false, remaining: hashes };
  const remaining = hashes.slice();
  remaining.splice(idx, 1);
  return { ok: true, remaining };
}

// --- Lockout policy ---------------------------------------------------------

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const SESSION_DEFAULT_HOURS = 12;
