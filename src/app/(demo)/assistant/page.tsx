import { PageHeader } from "@/components/primitives";
import { AssistantChat } from "@/components/AssistantChat";
import { resolveContext, type SearchParams } from "@/lib/domain/params";

export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const { data, templateId } = await resolveContext(searchParams);
  return (
    <>
      <PageHeader
        title="Assistant"
        meta={`Chat with an AI that knows your ${data.workspace.recordNounPlural.toLowerCase()} — grounded, cited, read-only.`}
      />
      <AssistantChat templateId={templateId} />
    </>
  );
}
