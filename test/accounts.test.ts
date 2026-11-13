import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { authTokens, users } from "@/server/db/schema";
import { devOutbox } from "@/server/email/transport";
import {
  completePasswordReset,
  confirmEmail,
  requestPasswordReset,
  startSignUp,
} from "@/server/accounts";
import { verifyLogin, UNVERIFIED_MESSAGE } from "@/server/users";
import { createSession, resolveSession } from "@/server/sessionStore";
import { MAX_TOKENS_PER_HOUR } from "@/server/authTokens";

/**
 * AUDIT H5/H6: sign-up with email verification and password reset, end to end
 * against the real database, with email captured in the dev outbox.
 */

let db: AnyPgDb;
let close: () => Promise<void>;

const lastTo = (to: string) => [...devOutbox].reverse().find((m) => m.to === to);
const tokenIn = (text: string, kind: "verify" | "reset") =>
  new RegExp(`/${kind}/([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? "";
const userRow = async (email: string) =>
  asService(db, async (tx) => (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0]);

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

beforeEach(() => {
  devOutbox.length = 0;
});

describe("sign-up and email verification (AUDIT H5)", () => {
  it("a new account cannot sign in until its email is confirmed; the link works once", async () => {
    await startSignUp({ name: "New", email: "New@Accounts.Test", password: "a-strong-password" });
    const mail = lastTo("new@accounts.test");
    expect(mail?.kind).toBe("verify_email");

    const before = await verifyLogin({ email: "new@accounts.test", password: "a-strong-password" });
    expect(before).toEqual({ ok: false, error: UNVERIFIED_MESSAGE });

    const token = tokenIn(mail!.text, "verify");
    const userId = await confirmEmail(token);
    expect(userId).toBe((await userRow("new@accounts.test"))!.id);
    expect(await confirmEmail(token)).toBeNull(); // single use

    expect((await verifyLogin({ email: "new@accounts.test", password: "a-strong-password" })).ok).toBe(true);
  });

  it("the unverified message is only shown to someone who knows the password", async () => {
    await startSignUp({ name: "Quiet", email: "quiet@accounts.test", password: "a-strong-password" });
    const wrong = await verifyLogin({ email: "quiet@accounts.test", password: "not-it-at-all" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).not.toBe(UNVERIFIED_MESSAGE);
  });

  it("signing up with a registered email changes nothing and emails the owner instead", async () => {
    await startSignUp({ name: "Owner", email: "taken@accounts.test", password: "owners-password-1" });
    const before = await userRow("taken@accounts.test");
    devOutbox.length = 0;

    await startSignUp({ name: "Someone", email: "taken@accounts.test", password: "intruder-password" });
    const after = await userRow("taken@accounts.test");
    expect(after!.passwordHash).toBe(before!.passwordHash);
    expect(after!.name).toBe("Owner");
    expect(lastTo("taken@accounts.test")?.kind).toBe("account_exists");
  });

  it("defeats account pre-hijacking: a password reset takes the address back", async () => {
    // An attacker registers the victim's address with a password they know.
    await startSignUp({ name: "Attacker", email: "victim@accounts.test", password: "attacker-knows-this" });
    // The attacker cannot use it: unverified accounts cannot sign in.
    expect((await verifyLogin({ email: "victim@accounts.test", password: "attacker-knows-this" })).ok).toBe(false);

    // The victim uses "forgot password", which proves the inbox and sets the password.
    await requestPasswordReset("victim@accounts.test");
    const reset = tokenIn(lastTo("victim@accounts.test")!.text, "reset");
    expect(await completePasswordReset(reset, "the-victims-own-password")).toBeTruthy();

    expect((await verifyLogin({ email: "victim@accounts.test", password: "attacker-knows-this" })).ok).toBe(false);
    expect((await verifyLogin({ email: "victim@accounts.test", password: "the-victims-own-password" })).ok).toBe(true);
  });
});

describe("password reset (AUDIT H6)", () => {
  const email = "reset@accounts.test";

  beforeAll(async () => {
    await startSignUp({ name: "Reset", email, password: "original-password" });
    await confirmEmail(tokenIn(lastTo(email)!.text, "verify"));
  });

  it("an unknown address sends nothing and does not throw", async () => {
    await expect(requestPasswordReset("nobody@accounts.test")).resolves.toBeUndefined();
    expect(devOutbox).toHaveLength(0);
  });

  it("sets the new password, signs out every session, clears lockout, and works once", async () => {
    const u = await userRow(email);
    const { token: sessionToken } = await createSession(u!.id);
    expect(await resolveSession(sessionToken)).not.toBeNull();
    await asService(db, (tx) =>
      tx.update(users).set({ lockedUntil: new Date(Date.now() + 3600_000) }).where(eq(users.id, u!.id)),
    );

    await requestPasswordReset(email);
    const token = tokenIn(lastTo(email)!.text, "reset");
    expect(await completePasswordReset(token, "brand-new-password")).toBe(u!.id);

    expect(await resolveSession(sessionToken)).toBeNull();
    expect((await verifyLogin({ email, password: "brand-new-password" })).ok).toBe(true);
    expect((await verifyLogin({ email, password: "original-password" })).ok).toBe(false);
    expect(await completePasswordReset(token, "yet-another-password")).toBeNull();
    expect(lastTo(email)?.kind).toBe("password_changed");
  });

  it("only the newest link works", async () => {
    await requestPasswordReset(email);
    const first = tokenIn(lastTo(email)!.text, "reset");
    await requestPasswordReset(email);
    const second = tokenIn(lastTo(email)!.text, "reset");
    expect(await completePasswordReset(first, "should-not-apply")).toBeNull();
    expect(await completePasswordReset(second, "second-link-wins")).toBeTruthy();
  });

  it("an expired link is rejected", async () => {
    await requestPasswordReset(email);
    const token = tokenIn(lastTo(email)!.text, "reset");
    await asService(db, (tx) => tx.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await completePasswordReset(token, "too-late-password")).toBeNull();
  });

  it("issuing links is rate-limited per account", async () => {
    await asService(db, (tx) => tx.delete(authTokens));
    devOutbox.length = 0;
    for (let i = 0; i < MAX_TOKENS_PER_HOUR + 2; i++) await requestPasswordReset(email);
    expect(devOutbox.filter((m) => m.kind === "password_reset")).toHaveLength(MAX_TOKENS_PER_HOUR);
  });
});
