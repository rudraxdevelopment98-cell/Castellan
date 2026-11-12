import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import nextConfig from "../next.config";

/**
 * AUDIT H8: every page carries a strict, nonce-based Content-Security-Policy
 * and the static hardening headers are configured for every response.
 */

const cspFor = () => {
  const res = middleware(new NextRequest("https://castellan.example/w/acme/today"));
  return res.headers.get("content-security-policy") ?? "";
};

const directive = (csp: string, name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "";

afterEach(() => vi.unstubAllEnvs());

describe("Content-Security-Policy (AUDIT H8)", () => {
  it("scripts require a per-request nonce and never allow inline or eval in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const script = directive(cspFor(), "script-src");
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("uses a different nonce for every request", () => {
    const nonce = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce(cspFor())).not.toBe(nonce(cspFor()));
  });

  it("locks down framing, plugins, base URI, form targets and third-party sources", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = cspFor();
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origin is allow-listed
  });
});

describe("static security headers (AUDIT H8)", () => {
  it("are configured for every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/(.*)");
    const get = (key: string) => all?.headers.find((h) => h.key === key)?.value;
    expect(get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("Permissions-Policy")).toBeTruthy();
  });
});
