import { requireUser } from "@/server/session";
import { getMembershipsForUser } from "@/server/context";
import { redirect } from "next/navigation";
import { templates } from "@/lib/data/templates";
import { createWorkspaceAction } from "../../(platform)/actions";

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

  return (
    <div className="rounded-panel border border-rule bg-surface p-6">
      <h1 className="text-section font-semibold text-ink">Create a workspace</h1>
      <p className="mt-1 text-meta text-ink-muted">
        A workspace is your organisation — its data, members and settings live inside it.
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
          {templates.map((t, i) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-ctl border border-rule px-3 py-2 hover:bg-canvas">
              <input type="radio" name="template" value={t.id} defaultChecked={i === 0} className="mt-1" />
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
        <button className="w-full rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white hover:opacity-90">
          Create workspace
        </button>
      </form>
    </div>
  );
}
