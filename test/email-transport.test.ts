import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { emailDeliveries } from "@/server/db/schema";
import { devOutbox, sendEmail, type OutgoingEmail } from "@/server/email/transport";
import { absoluteUrl } from "@/server/appUrl";
import { escapeHtml, invite } from "@/server/email/templates";

/**
 * AUDIT H5/H6/H9: delivery through Resend with retries, a delivery log that
 * never stores bodies, idempotent sends, and links that never come from the
 * request's Host header.
 */

let db: AnyPgDb;
let close: () => Promise<void>;

const msg = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  kind: "password_reset",
  to: "user@transport.test",
  subject: "Subject",
  html: "<p>secret-token-in-body</p>",
  text: "secret-token-in-body",
  ...over,
});

const deliveries = async (to: string): Promise<(typeof emailDeliveries.$inferSelect)[]> =>
  asService(db, (tx) => tx.select().from(emailDeliveries).where(eq(emailDeliveries.toEmail, to)));

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  devOutbox.length = 0;
});

describe("Resend delivery", () => {
  it("sends with the API key, records the provider id, and never stores the body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { id: "msg_123" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendEmail(msg({ to: "ok@transport.test" }));
    expect(res).toEqual({ ok: true, id: "msg_123" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_test_key" });

    const [row] = await deliveries("ok@transport.test");
    expect(row).toMatchObject({ status: "sent", providerId: "msg_123", kind: "password_reset" });
    expect(JSON.stringify(row)).not.toContain("secret-token-in-body");
  });

  it("retries a transient provider failure", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(503, { message: "busy" }))
      .mockResolvedValueOnce(reply(200, { id: "msg_456" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendEmail(msg({ to: "retry@transport.test" }), { retryDelayMs: 1 });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await deliveries("retry@transport.test"))[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does not retry a rejected request, and records the failure", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = vi.fn().mockResolvedValue(reply(422, { message: "invalid from address" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendEmail(msg({ to: "bad@transport.test" }), { retryDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await deliveries("bad@transport.test"))[0]).toMatchObject({ status: "failed" });
  });

  it("sends a message with a dedupe key at most once", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { id: "msg_once" }));
    vi.stubGlobal("fetch", fetchMock);
    const m = msg({ to: "brief@transport.test", kind: "daily_brief", dedupeKey: "brief:u1:2026-11-13" });
    await sendEmail(m);
    const second = await sendEmail(m);
    expect(second).toEqual({ ok: true, id: null, skipped: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await deliveries("brief@transport.test")).toHaveLength(1);
  });
});

describe("without a provider", () => {
  it("development captures the message instead of sending", async () => {
    const res = await sendEmail(msg({ to: "dev@transport.test" }));
    expect(res.ok).toBe(true);
    expect(devOutbox.map((m) => m.to)).toContain("dev@transport.test");
  });

  it("production refuses and records the failure rather than pretending", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await sendEmail(msg({ to: "prod@transport.test" }));
    expect(res.ok).toBe(false);
    expect(devOutbox).toHaveLength(0);
    expect((await deliveries("prod@transport.test"))[0]).toMatchObject({ status: "failed" });
  });
});

describe("links and content", () => {
  it("links come from APP_URL, never from a request", () => {
    vi.stubEnv("APP_URL", "https://castellan.example/");
    expect(absoluteUrl("/reset/abc")).toBe("https://castellan.example/reset/abc");
  });

  it("production without APP_URL or a Vercel domain refuses to build links", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(() => absoluteUrl("/x")).toThrow(/APP_URL/);
  });

  it("escapes user-controlled text in emails", () => {
    expect(escapeHtml(`<img src=x onerror="a">`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
    const m = invite("https://app/invite/t", "<b>Acme</b>", "Eve <script>", "member");
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Acme</b>");
  });
});
