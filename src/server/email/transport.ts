import { and, eq } from "drizzle-orm";
import { emailDeliveries } from "../db/schema";
import { asService, getDb } from "../db/client";

/**
 * Outbound email (AUDIT H5/H6/H9). Two providers, chosen by configuration:
 *
 *  - Resend (RESEND_API_KEY) — needs a verified sending domain to reach
 *    anyone but the Resend account owner.
 *  - SMTP (SMTP_USER + SMTP_PASS) — set up for Gmail with an app password, so
 *    a sender without a domain can still reach customers.
 *
 * With neither, development and tests collect messages in an in-process outbox
 * and production refuses (and records the failure) rather than pretending.
 *
 * Every attempt is recorded in `email_deliveries` — recipient, kind, outcome,
 * provider id — but never the body, because links in it carry single-use
 * tokens. Nothing here logs message content.
 */

export type EmailKind =
  | "verify_email"
  | "password_reset"
  | "account_exists"
  | "password_changed"
  | "invite"
  | "daily_brief"
  | "weekly_brief";

export interface OutgoingEmail {
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  userId?: string | null;
  workspaceId?: string | null;
  /** When set, a message with this key is sent at most once (briefs). */
  dedupeKey?: string;
}

export type SendResult =
  | { ok: true; id: string | null; skipped?: boolean }
  | { ok: false; error: string };

/**
 * Messages captured when no provider is configured (dev and tests only). Held
 * on globalThis because Next can load this module more than once in dev.
 */
const g = globalThis as unknown as { __castellanDevOutbox?: OutgoingEmail[] };
export const devOutbox: OutgoingEmail[] = (g.__castellanDevOutbox ??= []);

/** Tests only: drop the cached SMTP transport so a new mock is picked up. */
export function _resetSmtpForTests(): void {
  smtpTransport = null;
}

export type EmailProvider = "resend" | "smtp" | null;

export function emailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return null;
}

export function emailConfigured(): boolean {
  return emailProvider() !== null;
}

function fromAddress(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  // Gmail sends as the signed-in account whatever the header says, so default
  // to it. Resend's shared sender only reaches the Resend account's own inbox.
  if (emailProvider() === "smtp") return `Castellan <${process.env.SMTP_USER}>`;
  return "Castellan <onboarding@resend.dev>";
}

type ProviderOutcome = { id: string | null } | { error: string; retry: boolean };

// One pooled transport per process; created on first use.
let smtpTransport: import("nodemailer").Transporter | null = null;

async function sendViaSmtp(msg: OutgoingEmail): Promise<ProviderOutcome> {
  if (!smtpTransport) {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(process.env.SMTP_PORT || 465);
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS is required otherwise
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  try {
    const info = await smtpTransport.sendMail({
      from: fromAddress(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { id: info.messageId ?? null };
  } catch (e) {
    const err = e as { responseCode?: number; code?: string };
    // 4xx replies and network failures are worth retrying; 5xx (bad address,
    // auth rejected) are not. Never include the server's full reply.
    const code = err.responseCode;
    const retry = code ? code >= 400 && code < 500 : true;
    return { error: `smtp ${code ?? err.code ?? "error"}`, retry };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendViaResend(msg: OutgoingEmail): Promise<ProviderOutcome> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(msg.dedupeKey ? { "Idempotency-Key": msg.dedupeKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: fromAddress(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
  } catch {
    return { error: "network error reaching the email provider", retry: true };
  }
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: body.id ?? null };
  }
  // Provider messages describe the request, not the body; keep them short.
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  return { error: `provider returned ${res.status}${detail ? `: ${detail}` : ""}`, retry: res.status === 429 || res.status >= 500 };
}

async function record(
  msg: OutgoingEmail,
  status: "sent" | "failed" | "skipped",
  extra: { providerId?: string | null; error?: string; attempts?: number },
) {
  const db = await getDb();
  await asService(db, async (tx) => {
    const values = {
      kind: msg.kind,
      toEmail: msg.to,
      userId: msg.userId ?? null,
      workspaceId: msg.workspaceId ?? null,
      dedupeKey: msg.dedupeKey ?? null,
      status,
      providerId: extra.providerId ?? null,
      error: extra.error ?? null,
      attempts: extra.attempts ?? 1,
    };
    if (msg.dedupeKey) {
      // A failed attempt may be retried later; the row is updated, never duplicated.
      await tx
        .insert(emailDeliveries)
        .values(values)
        .onConflictDoUpdate({
          target: emailDeliveries.dedupeKey,
          set: { status, providerId: values.providerId, error: values.error, attempts: values.attempts, updatedAt: new Date() },
        });
    } else {
      await tx.insert(emailDeliveries).values(values);
    }
  });
}

async function alreadySent(dedupeKey: string): Promise<boolean> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [row] = await tx
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.dedupeKey, dedupeKey), eq(emailDeliveries.status, "sent")))
      .limit(1);
    return Boolean(row);
  });
}

/** Send one email, retrying transient provider failures, and log the outcome. */
export async function sendEmail(msg: OutgoingEmail, opts: { retryDelayMs?: number } = {}): Promise<SendResult> {
  if (msg.dedupeKey && (await alreadySent(msg.dedupeKey))) return { ok: true, id: null, skipped: true };

  const provider = emailProvider();
  if (!provider) {
    if (process.env.NODE_ENV === "production") {
      const error = "Email delivery is not configured (set SMTP_USER/SMTP_PASS or RESEND_API_KEY).";
      await record(msg, "failed", { error });
      return { ok: false, error };
    }
    devOutbox.push(msg);
    await record(msg, "sent", { providerId: "dev-outbox" });
    return { ok: true, id: "dev-outbox" };
  }

  const delay = opts.retryDelayMs ?? 500;
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = provider === "resend" ? await sendViaResend(msg) : await sendViaSmtp(msg);
    if ("id" in r) {
      await record(msg, "sent", { providerId: r.id, attempts: attempt });
      return { ok: true, id: r.id };
    }
    lastError = r.error;
    if (!r.retry || attempt === 3) {
      await record(msg, "failed", { error: lastError, attempts: attempt });
      break;
    }
    await sleep(delay * attempt);
  }
  return { ok: false, error: lastError };
}
