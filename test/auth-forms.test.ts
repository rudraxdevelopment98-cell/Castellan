import { describe, expect, it } from "vitest";
import { parseSignInForm, parseSignUpForm, signInSchema } from "@/server/validation";

/**
 * AUDIT C4: the sign-in form has no MFA field, so FormData yields null for it.
 * The form parser must treat an absent field as "not provided", not as invalid.
 */

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("sign-in form parsing (AUDIT C4)", () => {
  it("accepts the form exactly as the sign-in page submits it (no totp field)", () => {
    const res = parseSignInForm(form({ email: "User@Example.com ", password: "a-strong-password", next: "" }));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe("user@example.com");
      expect(res.data.totp).toBeUndefined();
    }
  });

  it("documents the bug: a null totp (what FormData.get returns) is not a valid value", () => {
    expect(signInSchema.safeParse({ email: "user@example.com", password: "x", totp: null }).success).toBe(false);
  });

  it("still passes a provided MFA code through", () => {
    const res = parseSignInForm(form({ email: "user@example.com", password: "pw", totp: " 123456 " }));
    expect(res.success && res.data.totp).toBe("123456");
  });

  it("still rejects a missing email or password", () => {
    expect(parseSignInForm(form({ password: "pw" })).success).toBe(false);
    expect(parseSignInForm(form({ email: "user@example.com" })).success).toBe(false);
  });
});

describe("sign-up form parsing", () => {
  it("accepts a complete form and rejects a short password", () => {
    expect(parseSignUpForm(form({ name: "A", email: "a@example.com", password: "long-enough-pw" })).success).toBe(true);
    expect(parseSignUpForm(form({ name: "A", email: "a@example.com", password: "short" })).success).toBe(false);
  });
});
