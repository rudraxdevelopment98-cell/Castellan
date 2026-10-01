import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { listMembers } from "@/server/tenancy";

export default async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");

  const db = await getDb();
  const members = await listMembers(db, { workspaceId: membership.workspaceId, actorUserId: user.id });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-title font-semibold text-ink">{membership.name}</h1>
        <p className="mt-1 text-meta text-ink-muted">
          Your role: {membership.role} · {members.length} member{members.length === 1 ? "" : "s"}
        </p>
      </div>

      <section className="rounded-panel border border-rule bg-surface p-5">
        <h2 className="text-section font-semibold text-ink">You&apos;re set up</h2>
        <p className="mt-1 text-body text-ink-muted">
          This is your workspace shell. Phase 2 adds the objects, fields and records the
          engine runs on; Phase 3 re-bases the Today / Compliance / Records screens onto
          this multi-tenant data.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/w/${slug}/today`} className="rounded-ctl bg-brand px-3 py-1.5 text-table font-medium text-white hover:opacity-90">
            Open Today
          </Link>
          <Link href={`/w/${slug}/members`} className="rounded-ctl border border-rule px-3 py-1.5 text-table text-ink hover:bg-canvas">
            Invite your team
          </Link>
        </div>
      </section>

      <section className="rounded-panel border border-rule bg-surface p-5">
        <h2 className="text-section font-semibold text-ink">Next steps</h2>
        <ul className="mt-2 space-y-1.5 text-body text-ink-muted">
          <li>· Invite teammates and assign roles (Members).</li>
          <li>· Provision a Supabase database to persist beyond this session.</li>
          <li>· Phase 2: define your objects and fields.</li>
        </ul>
      </section>
    </div>
  );
}
