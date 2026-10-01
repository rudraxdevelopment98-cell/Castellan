import { and, asc, eq } from "drizzle-orm";
import { rules } from "./db/schema";
import { withWorkspace, type AnyPgDb } from "./db/client";
import { actorRoleInTx } from "./membership";
import { requireCap } from "./rbac";
import { appendAudit } from "./audit";
import type { Cadence, Condition } from "@/lib/rules/types";

/** Admin of no-code obligation rules (spec rules_and_obligations.rule_builder). */

export interface NewRule {
  workspaceId: string;
  actorUserId: string;
  objectId: string;
  code?: string;
  title: string;
  why?: string;
  appliesWhen?: Condition[];
  triggerField: string;
  cadence: Cadence;
  reminderLadder?: number[];
  category?: string;
  evidenceRequired?: boolean;
  sourceNote?: string;
  lastVerified?: string;
  needsVerification?: boolean;
  enabled?: boolean;
}

export async function createRule(db: AnyPgDb, input: NewRule): Promise<{ ruleId: string }> {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, input.workspaceId, input.actorUserId), "structure.manage");
    const [row] = await tx
      .insert(rules)
      .values({
        workspaceId: input.workspaceId,
        objectId: input.objectId,
        code: input.code ?? null,
        title: input.title,
        why: input.why ?? null,
        appliesWhen: (input.appliesWhen ?? [{ kind: "always" }]) as unknown[],
        triggerField: input.triggerField,
        cadence: input.cadence as Record<string, unknown>,
        reminderLadder: input.reminderLadder ?? [],
        category: input.category ?? "General",
        evidenceRequired: input.evidenceRequired ?? false,
        sourceNote: input.sourceNote ?? null,
        lastVerified: input.lastVerified ?? null,
        needsVerification: input.needsVerification ?? false,
        enabled: input.enabled ?? true,
      })
      .returning({ id: rules.id });
    await appendAudit(tx, {
      workspaceId: input.workspaceId, actorUserId: input.actorUserId,
      action: "rule.created", entity: "rule", entityId: row.id, after: { title: input.title },
    });
    return { ruleId: row.id as string };
  });
}

export async function listRules(db: AnyPgDb, input: { workspaceId: string; actorUserId: string }) {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) =>
    tx.select().from(rules).orderBy(asc(rules.category), asc(rules.title)),
  );
}

export async function setRuleEnabled(
  db: AnyPgDb,
  input: { workspaceId: string; actorUserId: string; ruleId: string; enabled: boolean },
) {
  return withWorkspace(db, { workspaceId: input.workspaceId, userId: input.actorUserId }, async (tx) => {
    requireCap(await actorRoleInTx(tx, input.workspaceId, input.actorUserId), "structure.manage");
    await tx.update(rules).set({ enabled: input.enabled }).where(and(eq(rules.id, input.ruleId)));
    await appendAudit(tx, {
      workspaceId: input.workspaceId, actorUserId: input.actorUserId,
      action: input.enabled ? "rule.enabled" : "rule.disabled", entity: "rule", entityId: input.ruleId,
    });
  });
}
