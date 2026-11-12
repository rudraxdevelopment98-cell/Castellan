import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap verifyPassword so the test can observe that the expensive hash check
// runs on every failure path (that is what removes the timing side channel).
vi.mock("@/server/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { makeTestDb } from "./harness";
import { _setDbForTests } from "@/server/db/client";
import { verifyPassword, MAX_FAILED_LOGINS } from "@/server/auth";
import { createUser, verifyLogin, LOGIN_FAILED_MESSAGE } from "@/server/users";

/**
 * AUDIT H11: a failed sign-in must look the same — same message, same work —
 * whether the email is unknown, the password is wrong, or the account is locked.
 */

let close: () => Promise<void>;
const spy = vi.mocked(verifyPassword);

beforeAll(async () => {
  const t = await makeTestDb();
  close = () => t.pg.close();
  _setDbForTests(t.db);
  await createUser({ email: "real@oracle.test", password: "the-right-password", name: "Real" });
  await createUser({ email: "locked@oracle.test", password: "the-right-password", name: "Locked" });
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
    await verifyLogin({ email: "locked@oracle.test", password: "wrong" });
  }
});

afterAll(async () => {
  _setDbForTests(null);
  await close();
});

beforeEach(() => spy.mockClear());

describe("sign-in does not reveal whether an email exists (AUDIT H11)", () => {
  it("unknown email, wrong password and locked account return the identical message", async () => {
    const unknown = await verifyLogin({ email: "nobody@oracle.test", password: "whatever-it-is" });
    const wrong = await verifyLogin({ email: "real@oracle.test", password: "not-the-password" });
    const locked = await verifyLogin({ email: "locked@oracle.test", password: "the-right-password" });
    for (const r of [unknown, wrong, locked]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(LOGIN_FAILED_MESSAGE);
    }
  });

  it("an unknown email still performs one full password-hash verification", async () => {
    await verifyLogin({ email: "nobody@oracle.test", password: "whatever-it-is" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a locked account still performs one full password-hash verification", async () => {
    await verifyLogin({ email: "locked@oracle.test", password: "the-right-password" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the correct password still signs in", async () => {
    const ok = await verifyLogin({ email: "real@oracle.test", password: "the-right-password" });
    expect(ok.ok).toBe(true);
  });
});
