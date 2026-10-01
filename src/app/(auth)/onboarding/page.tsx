import { requireUser } from "@/server/session";
import { getMembershipsForUser } from "@/server/context";
import { redirect } from "next/navigation";
import { templates, PERSONAL_TEMPLATE_IDS } from "@/lib/data/templates";
import { createWorkspaceAction } from "../../(platform)/actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/onboarding");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  // If they already have a workspace, send them to it.
  const existing = await getMembershipsForUser(user.id);
  if (existing[0] && sp.new !== "1") redirect(`/w/${existing[0].slug}`);

  const personal = templates.filter((t) => PERSONAL_TEMPLATE_IDS.has(t.id));
  const business = templates.filter((t) => !PERSONAL_TEMPLATE_IDS.has(t.id));

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Create a workspace</h1>
      <p className="mt-1 text-meta text-ink-muted">
        A workspace is your space — for your own home &amp; personal papers, or for an
        organisation. Its data, members and settings live inside it.
      </p>
      {error && (
        <p className="mt-3 rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">
          {error}
        </p>
      )}
      <form action={createWorkspaceAction} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-meta text-ink-muted">Workspace name</span>
          <input
            name="name"
            required
            placeholder="e.g. Whitmore Portfolio"
            className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-meta text-ink-muted">Timezone</span>
            <input name="timezone" defaultValue="Europe/London" className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
          </label>
          <label className="block">
            <span className="text-meta text-ink-muted">Currency</span>
            <input name="currency" defaultValue="GBP" maxLength={3} className="mt-1 w-full rounded-ctl border border-rule bg-surface px-3 py-2 text-body uppercase text-ink" />
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-meta text-ink-muted">Start from a template</legend>

          <p className="pt-1 text-meta font-medium uppercase tracking-wide text-ink-muted">Personal</p>
          {personal.map((t, i) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-ctl border border-rule px-3 py-2 hover:bg-canvas">
              <input type="radio" name="template" value={t.id} defaultChecked={i === 0} className="mt-1" />
              <span>
                <span className="block text-table font-medium text-ink">{t.name}</span>
                <span className="block text-meta text-ink-muted">{t.tagline}</span>
              </span>
            </label>
          ))}

          <p className="pt-2 text-meta font-medium uppercase tracking-wide text-ink-muted">Business</p>
          {business.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-ctl border border-rule px-3 py-2 hover:bg-canvas">
              <input type="radio" name="template" value={t.id} className="mt-1" />
              <span>
                <span className="block text-table font-medium text-ink">{t.name}</span>
                <span className="block text-meta text-ink-muted">{t.tagline}</span>
              </span>
            </label>
          ))}
          <label className="flex cursor-pointer items-start gap-2 rounded-ctl border border-rule px-3 py-2 hover:bg-canvas">
            <input type="radio" name="template" value="" className="mt-1" />
            <span>
              <span className="block text-table font-medium text-ink">Blank</span>
              <span className="block text-meta text-ink-muted">Build your own objects and fields from scratch.</span>
            </span>
          </label>
        </fieldset>
        <label className="flex items-center gap-2 rounded-ctl border border-rule px-3 py-2">
          <input type="checkbox" name="samples" defaultChecked />
          <span className="text-table text-ink">Add sample data (landlord template only) so I can explore</span>
        </label>
        <SubmitButton pendingLabel="Creating workspace…">Create workspace</SubmitButton>
      </form>
    </div>
  );
}
