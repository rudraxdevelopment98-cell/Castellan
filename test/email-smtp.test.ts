import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { makeTestDb } from "./harness";
import { _setDbForTests, asService, type AnyPgDb } from "@/server/db/client";
import { emailDeliveries } from "@/server/db/schema";
import { _resetSmtpForTests, emailProvider, sendEmail } from "@/server/email/transport";

/**
 * Gmail / SMTP delivery: chosen when SMTP credentials are set, sends over TLS
 * as the configured account, retries transient failures only, logs outcomes.
 */

let db: AnyPgDb;
let close: () => Promise<void>;

const deliveries = async (to: string): Promise<(typeof emailDeliveries.$inferSelect)[]> =>
  asService(db, (tx) => tx.select().from(emailDeliveries).where(eq(emailDeliveries.toEmail, to)));

const msg = (to: string) => ({ kind: "invite" as const, to, subject: "S", html: "<p>h</p>", text: "t" });

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
  sendMail.mockReset();
  createTransport.mockClear();
  _resetSmtpForTests();
});

const useGmail = () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_USER", "owner@gmail.com");
  vi.stubEnv("SMTP_PASS", "app-password-here");
};

describe("SMTP (Gmail) delivery", () => {
  it("is selected by SMTP credentials and sends over implicit TLS to Gmail by default", async () => {
    useGmail();
    expect(emailProvider()).toBe("smtp");
    sendMail.mockResolvedValue({ messageId: "<abc@gmail>" });

    const res = await sendEmail(msg("smtp-ok@test.dev"));
    expect(res).toEqual({ ok: true, id: "<abc@gmail>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "owner@gmail.com", pass: "app-password-here" } }),
    );
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ from: "Castellan <owner@gmail.com>", to: "smtp-ok@test.dev" });
    expect((await deliveries("smtp-ok@test.dev"))[0]).toMatchObject({ status: "sent", providerId: "<abc@gmail>" });
  });

  it("retries a temporary (4xx) failure", async () => {
    useGmail();
    sendMail.mockRejectedValueOnce({ responseCode: 421 }).mockResolvedValueOnce({ messageId: "<retry>" });
    const res = await sendEmail(msg("smtp-retry@test.dev"), { retryDelayMs: 1 });
    expect(res.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent (5xx) failure, and records it", async () => {
    useGmail();
    sendMail.mockRejectedValue({ responseCode: 535 }); // bad credentials
    const res = await sendEmail(msg("smtp-bad@test.dev"), { retryDelayMs: 1 });
    expect(res).toEqual({ ok: false, error: "smtp 535" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((await deliveries("smtp-bad@test.dev"))[0]).toMatchObject({ status: "failed", error: "smtp 535" });
  });

  it("Resend takes precedence when both are configured", () => {
    useGmail();
    vi.stubEnv("RESEND_API_KEY", "re_x");
    expect(emailProvider()).toBe("resend");
  });
});
