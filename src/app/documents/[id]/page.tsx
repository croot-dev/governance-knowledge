import { BatchDetail } from "@/components/documents/batch-detail";
export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <BatchDetail id={(await params).id} />;
}
