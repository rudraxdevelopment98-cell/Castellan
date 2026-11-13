import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createUser, verifyLogin } from "@/server/users";
import { beginEnrolment, confirmEnrolment, disableMfa, verifySecondFactor } from "@/server/mfa";
import { MAX_FAILED_LOGINS } from "@/server/auth";

/**
 * AUDIT H7: TOTP enrolment, sign-in second step, recovery codes, replay
 * protection and lockout.
 */

let db: AnyPgDb;
let close: () => Promise<void>;
const T0 = new Date("2027-01-01T12:00:00Z").getTime();

async function user(email: string) {
  const u = await createUser({ email, password: "a-strong-password", name: email }, { emailVerified: true });
  if (!u.ok) throw new Error("setup");
  return u.user.id;
}

const codeAt = (secret: string, ms: number) => {
  vi.setSystemTime(ms);
  return authenticator.generate(secret);
};

async function enrol(userId: string, at = T0) {
  const { secret } = await beginEnrolment(userId);
  const res = await confirmEnrolment(userId, codeAt(secret, at));
  if (!res.ok) throw new Error(res.error);
  return { secret, recoveryCodes: res.recoveryCodes };
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = () => t.pg.close();
  _setDbForTests(db);
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enrolment", () => {
  it("a secret is not active until confirmed with a valid code", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("enrol@mfa.test");
    const { secret } = await beginEnrolment(id);
    expect((await verifyLogin({ email: "enrol@mfa.test", password: "a-strong-password" })).ok && true).toBe(true);
    const login = await verifyLogin({ email: "enrol@mfa.test", password: "a-strong-password" });
    expect(login.ok && login.mfaRequired).toBe(false);

    expect((await confirmEnrolment(id, "000000")).ok).toBe(false);
    const ok = await confirmEnrolment(id, codeAt(secret, T0));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.recoveryCodes).toHaveLength(10);

    const after = await verifyLogin({ email: "enrol@mfa.test", password: "a-strong-password" });
    expect(after.ok && after.mfaRequired).toBe(true);
  });

  it("recovery codes are stored only as hashes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("hashes@mfa.test");
    const { recoveryCodes } = await enrol(id);
    const [row] = (await asService(db, (tx) => tx.select().from(users).where(eq(users.id, id)))) as (typeof users.$inferSelect)[];
    const stored = JSON.stringify(row!.recoveryCodes);
    for (const c of recoveryCodes) expect(stored).not.toContain(c);
  });
});

describe("second step of sign-in", () => {
  it("accepts a current code once, and rejects the same code replayed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("replay@mfa.test");
    const { secret } = await enrol(id, T0);
    const later = T0 + 5 * 60_000;
    const code = codeAt(secret, later);
    expect((await verifySecondFactor(id, code)).ok).toBe(true);
    const again = await verifySecondFactor(id, code);
    expect(again).toMatchObject({ ok: false });
    expect(again.error).toMatch(/already used/);
    // The next step's code works.
    expect((await verifySecondFactor(id, codeAt(secret, later + 30_000))).ok).toBe(true);
  });

  it("a recovery code works exactly once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("recovery@mfa.test");
    const { recoveryCodes } = await enrol(id);
    const code = recoveryCodes[0]!;
    expect(await verifySecondFactor(id, code.toUpperCase())).toMatchObject({ ok: true, usedRecoveryCode: true });
    expect((await verifySecondFactor(id, code)).ok).toBe(false);
  });

  it("wrong codes lock the account, after which even a right code is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("lock@mfa.test");
    const { secret } = await enrol(id, T0);
    vi.setSystemTime(T0 + 60_000);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await verifySecondFactor(id, "000000");
    const res = await verifySecondFactor(id, codeAt(secret, T0 + 60_000));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Too many/);
  });
});

describe("turning it off", () => {
  it("needs a valid code, then clears the secret and recovery codes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = await user("off@mfa.test");
    const { secret } = await enrol(id, T0);
    expect((await disableMfa(id, "000000")).ok).toBe(false);
    expect((await disableMfa(id, codeAt(secret, T0 + 90_000))).ok).toBe(true);
    const [row] = (await asService(db, (tx) => tx.select().from(users).where(eq(users.id, id)))) as (typeof users.$inferSelect)[];
    expect(row).toMatchObject({ mfaEnabled: false, totpSecret: null, recoveryCodes: null });
  });
});
