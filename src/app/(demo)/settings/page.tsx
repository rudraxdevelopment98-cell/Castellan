import { Content, PageHeader, Panel } from "@/components/primitives";
import { TemplateSwitcher, type TemplateOption } from "@/components/TemplateSwitcher";
import { templates } from "@/lib/data/templates";
import { formatUkDate } from "@/lib/rules/dates";
import { resolveContext, type SearchParams } from "@/lib/domain/params";

function cadenceLabel(c: import("@/lib/rules/types").Cadence): string {
  switch (c.kind) {
    case "recurring_months": return `Every ${c.every} months`;
    case "recurring_years": return `Every ${c.every} year${c.every === 1 ? "" : "s"}`;
    case "offset_days": return `Within ${c.days} days`;
    case "fixed_date": return `By ${formatUkDate(c.date)}`;
    case "watch": return "Watch (no due date)";
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, templateId } = await resolveContext(searchParams);

  const options: TemplateOption[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    audience: t.audience,
    ruleCount: t.rules.length,
  }));

  return (
    <>
      <PageHeader title="Settings" meta="Templates, rules and security." />
      <Content>
        <Panel title="Workspace template">
          <div className="px-4 py-4">
            <p className="mb-3 text-meta text-ink-muted">
              Castellan works for any business that tracks documents and deadlines.
              Switch the rule pack to see the same engine, screens and morning brief
              adapt. Landlord is the flagship; the rest are starting points.
            </p>
            <TemplateSwitcher options={options} active={templateId} />
          </div>
        </Panel>

        <Panel title="Obligation rules" right={<span className="text-meta text-ink-muted">{data.template.rules.length} rules · editable</span>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-table">
              <thead>
                <tr className="border-b border-rule text-left text-ink-muted">
                  <th className="px-4 py-2 font-medium">Rule</th>
                  <th className="px-2 py-2 font-medium">Cadence</th>
                  <th className="px-2 py-2 font-medium">Reminders (days)</th>
                  <th className="px-2 py-2 font-medium">Evidence</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Verified</th>
                </tr>
              </thead>
              <tbody>
                {data.template.rules.map((r) => (
                  <tr key={r.code} className="border-b border-rule align-top hover:bg-canvas last:border-b-0">
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink">{r.title}</span>
                      <span className="block text-meta text-ink-muted">{r.why}</span>
                    </td>
                    <td className="px-2 py-2 text-ink-muted">{cadenceLabel(r.cadence)}</td>
                    <td className="tnum px-2 py-2 text-ink-muted">{r.reminderLadderDays.join(", ") || "—"}</td>
                    <td className="px-2 py-2 text-ink-muted">{r.evidenceRequired ? "Required" : "—"}</td>
                    <td className="px-2 py-2">
                      {r.needsVerification ? (
                        <span className="text-due-soon">Needs verification</span>
                      ) : r.enabled ? (
                        <span className="text-ok">Enabled</span>
                      ) : (
                        <span className="text-ink-muted">Disabled</span>
                      )}
                    </td>
                    <td className="tnum px-2 py-2 text-ink-muted">
                      {r.lastVerified ? formatUkDate(r.lastVerified) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-rule px-4 py-2 text-meta text-ink-muted">
            Rules are data, never hard-coded. Editing a reminder ladder regenerates future
            reminders but never alters completed history. Legal rules carry a last-verified date.
          </p>
        </Panel>

        <Panel title="Security & data">
          <ul className="divide-y divide-rule">
            {[
              ["Data residency", `UK region (${data.workspace.dataRegion}) · UK GDPR`],
              ["Multi-factor auth", "Required for owner & admin · passkeys supported"],
              ["Encryption", "At rest for all files · field-level for account refs, ID docs, key safe codes"],
              ["Audit log", "Immutable record of every sensitive view, confirmation and change"],
              ["Uploads", "Signed, expiring contractor links · malware scanned · rate limited"],
              ["AI safety", "Document text is data, never instructions · extractor has no tool access"],
              ["Export", "Full data export any time — no lock-in"],
            ].map(([k, v]) => (
              <li key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-table font-medium text-ink">{k}</span>
                <span className="text-meta text-ink-muted">{v}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </Content>
    </>
  );
}
