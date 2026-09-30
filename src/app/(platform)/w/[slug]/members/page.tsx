import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { listMembers, listPendingInvitations } from "@/server/tenancy";
import { can } from "@/server/rbac";
import { inviteMemberAction } from "../../../actions";

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/w/${slug}/members`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");

  const db = await getDb();
  const [members, pending] = await Promise.all([
    listMembers(db, { workspaceId: membership.workspaceId, actorUserId: user.id }),
    listPendingInvitations(db, { workspaceId: membership.workspaceId, actorUserId: user.id }),
  ]);
  const canManage = can(membership.role, "members.manage");

  const error = typeof sp.error === "string" ? sp.error : null;
  const invited = typeof sp.invited === "string" ? sp.invited : null;
  const link = typeof sp.link === "string" ? sp.link : null;

  return (
    <div className="space-y-5">
      <h1 className="text-title font-semibold text-ink">Members</h1>

      {invited && (
        <div className="rounded-ctl border border-ok/40 bg-ok/10 px-3 py-2 text-meta text-ok">
          Invited {invited}.
          {link && (
            <>
              {" "}No email is sent in local dev — share this link:{" "}
              <a href={link} className="font-medium underline">{link}</a>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="rounded-ctl border border-overdue/40 bg-overdue/10 px-3 py-2 text-meta text-overdue">{error}</div>
      )}

      <section className="overflow-hidden rounded-panel border border-rule bg-surface">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="border-b border-rule text-left text-ink-muted">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m: { userId: string; name: string | null; email: string | null; role: string }) => (
              <tr key={m.userId} className="border-b border-rule last:border-b-0">
                <td className="px-4 py-2 text-ink">{m.name ?? "—"}</td>
                <td className="px-4 py-2 text-ink-muted">{m.email}</td>
                <td className="px-4 py-2 text-ink-muted">{m.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pending.length > 0 && (
        <section className="rounded-panel border border-rule bg-surface p-4">
          <h2 className="text-section font-semibold text-ink">Pending invitations</h2>
          <ul className="mt-2 divide-y divide-rule">
            {pending.map((p: { id: string; email: string; role: string }) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-table">
                <span className="text-ink">{p.email}</span>
                <span className="text-meta text-ink-muted">{p.role} · pending</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage ? (
        <section className="rounded-panel border border-rule bg-surface p-4">
          <h2 className="text-section font-semibold text-ink">Invite a member</h2>
          <form action={inviteMemberAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <label className="block">
              <span className="text-meta text-ink-muted">Email</span>
              <input name="email" type="email" required className="mt-1 w-64 rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink" />
            </label>
            <label className="block">
              <span className="text-meta text-ink-muted">Role</span>
              <select name="role" defaultValue="member" className="mt-1 rounded-ctl border border-rule bg-surface px-3 py-2 text-body text-ink">
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
                <option value="guest">Guest</option>
              </select>
            </label>
            <button className="rounded-ctl bg-brand px-3 py-2 text-table font-medium text-white hover:opacity-90">Send invite</button>
          </form>
        </section>
      ) : (
        <p className="text-meta text-ink-muted">Your role can view members but not invite.</p>
      )}
    </div>
  );
}
