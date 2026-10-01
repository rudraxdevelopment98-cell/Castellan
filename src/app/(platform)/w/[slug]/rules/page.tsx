import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { listRules } from "@/server/rules_admin";
import { can } from "@/server/rbac";
import { setRuleEnabledAction } from "../../../actions";

function cadenceLabel(c: Record<string, unknown>): string {
  switch (c.kind) {
    case "recurring_months": return `Every ${c.every} months`;
    case "recurring_years": return `Every ${c.every} year${c.every === 1 ? "" : "s"}`;
    case "offset_days": return c.days === 0 ? "On the date" : `Within ${c.days} days`;
    case "fixed_date": return `By ${c.date}`;
    case "watch": return "Watch";
    default: return "—";
  }
}

export default async function RulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}/rules`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const rows = await listRules(db, { workspaceId: membership.workspaceId, actorUserId: user.id });
  const canManage = can(membership.role, "structure.manage");

  return (
    <div className="space-y-4">
      <h1 className="text-title font-semibold text-ink">Rules</h1>
      <p className="text-meta text-ink-muted">
        Obligation rules turn a record&apos;s trigger date into dated reminders. Editing a ladder regenerates
        future reminders but never alters completed history.
      </p>
      <div className="overflow-hidden rounded-panel border border-rule bg-surface">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="border-b border-rule text-left text-ink-muted">
              <th className="px-4 py-2 font-medium">Rule</th>
              <th className="px-3 py-2 font-medium">Trigger field</th>
              <th className="px-3 py-2 font-medium">Cadence</th>
              <th className="px-3 py-2 font-medium">Reminders (days)</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {canManage && <th className="px-3 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: {
              id: string; title: string; why: string | null; triggerField: string;
              cadence: Record<string, unknown>; reminderLadder: number[]; enabled: boolean;
              lastVerified: string | null; needsVerification: boolean;
            }) => (
              <tr key={r.id} className="border-b border-rule align-top last:border-b-0">
                <td className="px-4 py-2">
                  <span className="font-medium text-ink">{r.title}</span>
                  {r.why && <span className="block text-meta text-ink-muted">{r.why}</span>}
                  {r.lastVerified && <span className="block text-meta text-ink-muted">Last verified {r.lastVerified}</span>}
                </td>
                <td className="px-3 py-2 text-ink-muted">{r.triggerField}</td>
                <td className="px-3 py-2 text-ink-muted">{cadenceLabel(r.cadence)}</td>
                <td className="tnum px-3 py-2 text-ink-muted">{(r.reminderLadder ?? []).join(", ") || "—"}</td>
                <td className="px-3 py-2">
                  {r.needsVerification ? <span className="text-due-soon">Needs verification</span>
                    : r.enabled ? <span className="text-ok">Enabled</span>
                    : <span className="text-ink-muted">Disabled</span>}
                </td>
                {canManage && (
                  <td className="px-3 py-2">
                    <form action={setRuleEnabledAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <input type="hidden" name="enabled" value={(!r.enabled).toString()} />
                      <button className="rounded-ctl border border-rule px-2.5 py-1 text-meta text-ink hover:bg-canvas">
                        {r.enabled ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted">No rules yet. Landlord workspaces get a compliance pack automatically.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
