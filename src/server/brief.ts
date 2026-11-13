import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { memberships, users, workspaces } from "./db/schema";
import { asService, getDb } from "./db/client";
import { buildTodayPlan, buildWeekPlan, type ObligationView } from "./today";
import { todayInZone, formatUkDate, diffDays, type IsoDate } from "@/lib/rules/dates";
import { absoluteUrl } from "./appUrl";
import { sendEmail } from "./email/transport";
import { dailyBrief, type BriefItem } from "./email/templates";

/**
 * The morning brief (AUDIT H9): one email per member per workspace per local
 * day, listing what is overdue, due today and good to start — built with the
 * member's own record scope, so nobody is emailed what they may not see.
 *
 * Safe to run repeatedly: each message carries a dedupe key of
 * workspace + user + local date, so a re-run sends nothing new, and a failed
 * send is retried on the next run. Members who switched it off, unverified
 * addresses and suspended or closed workspaces get nothing. Days with nothing
 * to report send nothing.
 */

/** Workspaces in these states still need their reminders. */
const SENDING_STATES = ["trial", "active", "past_due"] as const;

export interface BriefRunResult {
  workspaces: number;
  sent: number;
  skippedEmpty: number;
  alreadySent: number;
  failed: number;
  stoppedEarly: boolean;
}

function relative(due: IsoDate, today: IsoDate): string {
  const d = diffDays(due, today);
  if (d < 0) return `overdue by ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

const toItem = (today: IsoDate) => (o: ObligationView): BriefItem => ({
  title: o.title,
  where: o.recordLabel,
  due: o.dueDate ? `${formatUkDate(o.dueDate)} · ${relative(o.dueDate, today)}` : "no date",
});

function isMonday(date: IsoDate): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() === 1;
}

export async function sendDailyBriefs(opts: { now?: Date; deadlineMs?: number } = {}): Promise<BriefRunResult> {
  const now = opts.now ?? new Date();
  const stopAt = Date.now() + (opts.deadlineMs ?? 50_000);
  const db = await getDb();
  const result: BriefRunResult = { workspaces: 0, sent: 0, skippedEmpty: 0, alreadySent: 0, failed: 0, stoppedEarly: false };

  const wss = await asService(db, async (tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, timezone: workspaces.timezone })
      .from(workspaces)
      .where(inArray(workspaces.status, [...SENDING_STATES])),
  ) as { id: string; name: string; slug: string; timezone: string }[];

  for (const ws of wss) {
    result.workspaces++;
    const today = todayInZone(ws.timezone, now);
    const recipients = await asService(db, async (tx) =>
      tx
        .select({ userId: users.id, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.briefEmail, true), isNotNull(users.emailVerifiedAt))),
    ) as { userId: string; email: string }[];

    for (const r of recipients) {
      if (Date.now() > stopAt) {
        // The next run picks up where this one stopped; nothing is sent twice.
        result.stoppedEarly = true;
        return result;
      }
      const plan = await buildTodayPlan(db, { workspaceId: ws.id, actorUserId: r.userId, today });
      const week = isMonday(today)
        ? (await buildWeekPlan(db, { workspaceId: ws.id, actorUserId: r.userId, today })).slice(1).flatMap((c) => c.items)
        : undefined;
      if (plan.counts.total === 0 && !(week && week.length)) {
        result.skippedEmpty++;
        continue;
      }
      const item = toItem(today);
      const email = dailyBrief({
        workspaceName: ws.name,
        dateLabel: formatUkDate(today),
        todayUrl: absoluteUrl(`/w/${ws.slug}/today`),
        settingsUrl: absoluteUrl(`/w/${ws.slug}/today#brief`),
        sections: {
          overdue: plan.overdue.map(item),
          dueToday: plan.dueToday.map(item),
          startSoon: plan.startSoon.map(item),
          thisWeek: week?.map(item),
        },
      });
      const res = await sendEmail({
        kind: "daily_brief",
        to: r.email,
        userId: r.userId,
        workspaceId: ws.id,
        dedupeKey: `brief:${ws.id}:${r.userId}:${today}`,
        ...email,
      });
      if (!res.ok) result.failed++;
      else if (res.skipped) result.alreadySent++;
      else result.sent++;
    }
  }
  return result;
}

/** Turn the morning email on or off for one member of one workspace. */
export async function setBriefEmail(input: { workspaceId: string; userId: string; on: boolean }): Promise<void> {
  const db = await getDb();
  await asService(db, (tx) =>
    tx
      .update(memberships)
      .set({ briefEmail: input.on })
      .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId))),
  );
}

export async function getBriefEmail(input: { workspaceId: string; userId: string }): Promise<boolean> {
  const db = await getDb();
  return asService(db, async (tx) => {
    const [m] = await tx
      .select({ on: memberships.briefEmail })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)))
      .limit(1);
    return Boolean(m?.on);
  });
}
