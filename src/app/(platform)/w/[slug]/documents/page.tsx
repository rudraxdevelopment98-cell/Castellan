import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { resolveWorkspaceForUser } from "@/server/context";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/documents";
import { PageHeader, Content, Stat } from "@/components/primitives";
import { DocumentsManager, type DocItem } from "@/components/DocumentsManager";

export const dynamic = "force-dynamic";

function countsByUrgency(docs: DocItem[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let overdue = 0;
  let soon = 0;
  let withDates = 0;
  for (const d of docs) {
    if (!d.keyDate) continue;
    withDates++;
    const due = new Date(`${d.keyDate.split("T")[0]}T00:00:00`);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days < 0) overdue++;
    else if (days <= 30) soon++;
  }
  return { overdue, soon, withDates };
}

export default async function DocumentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/w/${slug}/documents`);
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/onboarding");
  const db = await getDb();

  const docs = (await listDocuments(db, {
    workspaceId: membership.workspaceId,
    actorUserId: user.id,
  })) as DocItem[];

  const { overdue, soon, withDates } = countsByUrgency(docs);
  const typeOptions = Array.from(
    new Set(docs.map((d) => d.docType).filter((t): t is string => Boolean(t))),
  );

  return (
    <>
      <PageHeader
        title="Documents"
        meta="Upload your files — add a key date and Castellan reminds you before it expires."
      />
      <Content>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Documents" value={docs.length} />
          <Stat label="With a key date" value={withDates} />
          <Stat label="Due in 30 days" value={soon} tone={soon > 0 ? "overdue" : undefined} />
          <Stat label="Overdue" value={overdue} tone={overdue > 0 ? "overdue" : "ok"} />
        </div>

        <DocumentsManager slug={slug} documents={docs} docTypeOptions={typeOptions} />
      </Content>
    </>
  );
}
