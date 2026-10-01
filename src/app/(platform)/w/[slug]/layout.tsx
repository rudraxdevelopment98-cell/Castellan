import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMembershipsForUser, resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { listObjects } from "@/server/metadata";
import { signOutAction } from "../../../(auth)/actions";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { WorkspaceNav, type NavItem } from "@/components/WorkspaceNav";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const all = await getMembershipsForUser(user.id);
  const db = await getDb();
  const objects = await listObjects(db, { workspaceId: membership.workspaceId, actorUserId: user.id });

  const items: NavItem[] = [
    { href: `/w/${slug}/today`, label: "Today" },
    { href: `/w/${slug}/week`, label: "This week" },
    ...objects.map((o: { apiName: string; pluralLabel: string }) => ({ href: `/w/${slug}/o/${o.apiName}`, label: o.pluralLabel })),
    { href: `/w/${slug}/documents`, label: "Documents" },
    { href: `/w/${slug}/rules`, label: "Rules" },
    { href: `/w/${slug}/data`, label: "Data model" },
    { href: `/w/${slug}/members`, label: "Members" },
  ];

  const account = (
    <div className="text-meta text-ink-muted">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" /> Data in UK / EU region
      </div>
      <div className="mt-1 truncate">{user.email} · {membership.role}</div>
      <form action={signOutAction} className="mt-2">
        <button className="rounded-ctl border border-rule px-2.5 py-1 text-meta text-ink hover:bg-canvas">Sign out</button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop left sidebar (spec ui_ux.layout.desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-rule bg-surface md:flex">
        <div className="border-b border-rule px-4 py-4">
          <div className="font-serif text-[24px] font-semibold leading-none tracking-wide text-ink">Castellan</div>
          <div className="mt-2">
            <WorkspaceSwitcher current={slug} options={all.map((w) => ({ slug: w.slug, name: w.name }))} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <WorkspaceNav items={items} slug={slug} />
        </div>
        <div className="border-t border-rule px-4 py-3">{account}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-surface px-4 py-2 md:hidden">
          <span className="font-serif text-[20px] font-semibold tracking-wide text-ink">Castellan</span>
          <WorkspaceSwitcher current={slug} options={all.map((w) => ({ slug: w.slug, name: w.name }))} />
          <form action={signOutAction} className="ml-auto">
            <button className="rounded-ctl border border-rule px-2.5 py-1 text-meta text-ink hover:bg-canvas">Sign out</button>
          </form>
          <div className="w-full overflow-x-auto">
            <div className="flex gap-1 whitespace-nowrap">
              <WorkspaceNav items={items} slug={slug} />
            </div>
          </div>
        </div>
        <main className="mx-auto w-full max-w-5xl px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
