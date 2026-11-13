import { and, eq } from "drizzle-orm";
import { emailDeliveries } from "../db/schema";
import { asService, getDb } from "../db/client";

/**
 * Outbound email (AUDIT H5/H6/H9). Production sends through Resend's HTTP API;
 * without RESEND_API_KEY, development and tests collect messages in an
 * in-process outbox instead, and production refuses (and records the failure)
 * rather than pretending to send.
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

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  // Resend's shared sender works without a verified domain, but can only
  // deliver to the Resend account's own address. Set EMAIL_FROM to an address
  // on a verified domain before inviting real users.
  return process.env.EMAIL_FROM || "Castellan <onboarding@resend.dev>";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendViaResend(msg: OutgoingEmail): Promise<{ id: string | null } | { error: string; retry: boolean }> {
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

  if (!emailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      const error = "Email delivery is not configured (RESEND_API_KEY is missing).";
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
    const r = await sendViaResend(msg);
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
