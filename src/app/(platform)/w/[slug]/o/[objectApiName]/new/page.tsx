import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getObjectByApiName } from "@/server/metadata";
import { RecordForm } from "@/components/RecordForm";

export default async function NewRecord({ params }: { params: Promise<{ slug: string; objectApiName: string }> }) {
  const { slug, objectApiName } = await params;
  const user = await requireUser(`/w/${slug}/o/${objectApiName}/new`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: objectApiName });
  if (!obj) notFound();

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <Link href={`/w/${slug}/o/${objectApiName}`} className="text-meta text-ink-muted hover:underline">← {obj.pluralLabel}</Link>
        <h1 className="mt-1 text-title font-semibold text-ink">New {obj.singularLabel.toLowerCase()}</h1>
      </div>
      <RecordForm slug={slug} objectApiName={objectApiName} fields={obj.fields} mode="create" />
    </div>
  );
}
