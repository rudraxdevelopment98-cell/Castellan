import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMembershipsForUser, resolveWorkspaceForUser } from "@/server/context";
import { signOutAction } from "../../../(auth)/actions";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

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

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule bg-surface px-5 py-3">
        <span className="font-serif text-[22px] font-semibold tracking-wide text-ink">Castellan</span>
        <WorkspaceSwitcher current={slug} options={all.map((w) => ({ slug: w.slug, name: w.name }))} />
        <nav className="ml-2 flex items-center gap-1 text-table">
          <Link href={`/w/${slug}`} className="rounded-ctl px-3 py-1.5 text-ink hover:bg-canvas">Home</Link>
          <Link href={`/w/${slug}/members`} className="rounded-ctl px-3 py-1.5 text-ink hover:bg-canvas">Members</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-meta text-ink-muted">{user.email} · {membership.role}</span>
          <form action={signOutAction}>
            <button className="rounded-ctl border border-rule px-3 py-1.5 text-meta text-ink hover:bg-canvas">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-6">{children}</main>
    </div>
  );
}
