import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { getObjectByApiName } from "@/server/metadata";
import { ImportWizard } from "@/components/ImportWizard";

export default async function ImportPage({ params }: { params: Promise<{ slug: string; objectApiName: string }> }) {
  const { slug, objectApiName } = await params;
  const user = await requireUser(`/w/${slug}/o/${objectApiName}/import`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();
  const obj = await getObjectByApiName(db, { workspaceId: membership.workspaceId, actorUserId: user.id, apiName: objectApiName });
  if (!obj) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <Link href={`/w/${slug}/o/${objectApiName}`} className="text-meta text-ink-muted hover:underline">← {obj.pluralLabel}</Link>
        <h1 className="mt-1 text-title font-semibold text-ink">Import {obj.pluralLabel.toLowerCase()}</h1>
        <p className="mt-1 text-meta text-ink-muted">
          Upload or paste a CSV with a header row. Columns are matched to your fields by name; every row is
          validated before anything is written, and you can undo the whole import.
        </p>
        <p className="mt-1 text-meta text-ink-muted">
          Fields: {obj.fields.map((f) => f.apiName).join(", ")}
        </p>
      </div>
      <ImportWizard slug={slug} objectApiName={objectApiName} />
    </div>
  );
}
