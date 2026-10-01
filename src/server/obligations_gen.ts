import { and, eq, isNull, ne } from "drizzle-orm";
import { obligations, records, rules } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import {
  computeDueDate,
  computeReminderDates,
  ruleApplies,
} from "@/lib/rules/engine";
import type { Cadence, Condition, ObligationRule, TrackedRecord } from "@/lib/rules/types";

/**
 * Obligation generation. Reuses the Phase-1 rules engine (pure, tested) over the
 * workspace's real records: for each enabled rule and each record it applies to,
 * compute the due date from the record's trigger-date field + cadence, with the
 * reminder ladder. Idempotent — same rule+record+cycle never duplicates (spec
 * rules_and_obligations). Moving a trigger date replaces the open obligation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEngineRule(row: any): ObligationRule {
  return {
    code: row.code ?? row.id,
    title: row.title,
    why: row.why ?? "",
    appliesWhen: (row.appliesWhen as Condition[]) ?? [{ kind: "always" }],
    triggerField: row.triggerField,
    cadence: row.cadence as Cadence,
    reminderLadderDays: (row.reminderLadder as number[]) ?? [],
    evidenceRequired: row.evidenceRequired,
    category: row.category,
    enabled: row.enabled,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTrackedRecord(row: any): TrackedRecord {
  const data = (row.data as Record<string, unknown>) ?? {};
  // The engine reads fields then triggers; records keep everything in `data`.
  return {
    id: row.id,
    label: row.title ?? row.id,
    recordTypeId: row.objectId,
    fields: data as TrackedRecord["fields"],
    triggers: data as TrackedRecord["triggers"],
  };
}

export async function regenerateObligations(
  db: AnyPgDb,
  cmd: { workspaceId: string; actorUserId: string },
): Promise<{ generated: number }> {
  return withWorkspace(db, { workspaceId: cmd.workspaceId, userId: cmd.actorUserId }, async (tx) => {
    const ruleRows = await tx.select().from(rules).where(eq(rules.enabled, true));
    let generated = 0;

    for (const r of ruleRows) {
      const engineRule = toEngineRule(r);
      const recRows = await tx
        .select()
        .from(records)
        .where(and(eq(records.objectId, r.objectId), isNull(records.deletedAt)));

      for (const rec of recRows) {
        const tracked = toTrackedRecord(rec);
        if (!ruleApplies(tracked, engineRule)) continue;
        const triggerDate = tracked.triggers[engineRule.triggerField];
        const dueDate = computeDueDate(engineRule.cadence, triggerDate);
        const cycleKey = dueDate ?? "watch";
        const reminderDates =
          dueDate && engineRule.cadence.kind !== "watch"
            ? computeReminderDates(dueDate, engineRule.reminderLadderDays)
            : [];

        // Replace any stale OPEN obligation for this rule+record from a prior cycle.
        await tx
          .delete(obligations)
          .where(
            and(
              eq(obligations.ruleId, r.id),
              eq(obligations.recordId, rec.id),
              eq(obligations.status, "open"),
              ne(obligations.cycleKey, cycleKey),
            ),
          );

        await tx
          .insert(obligations)
          .values({
            workspaceId: cmd.workspaceId,
            ruleId: r.id,
            recordId: rec.id,
            title: engineRule.title,
            why: engineRule.why,
            category: engineRule.category,
            dueDate,
            cycleKey,
            reminderDates,
            evidenceRequired: engineRule.evidenceRequired,
          })
          .onConflictDoUpdate({
            target: [obligations.workspaceId, obligations.ruleId, obligations.recordId, obligations.cycleKey],
            set: {
              title: engineRule.title,
              why: engineRule.why,
              category: engineRule.category,
              dueDate,
              reminderDates,
              evidenceRequired: engineRule.evidenceRequired,
              updatedAt: new Date(),
            },
          });
        generated++;
      }
    }
    return { generated };
  });
}
