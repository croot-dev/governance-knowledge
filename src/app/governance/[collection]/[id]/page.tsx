import { notFound } from "next/navigation";
import { collectionSchema, idSchema } from "@/domain/validation";
import { EntityDetail } from "@/components/entity-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ collection: string; id: string }>;
}) {
  const { collection, id } = await params;
  const c = collectionSchema.safeParse(collection);
  if (!c.success || !idSchema.safeParse(id).success) notFound();
  return (
    <EntityDetail key={`${collection}:${id}`} collection={c.data} id={id} />
  );
}
