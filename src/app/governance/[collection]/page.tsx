import { notFound } from "next/navigation";
import { collectionSchema } from "@/domain/validation";
import { EntityList } from "@/components/entity-list";
export default async function Page({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const parsed = collectionSchema.safeParse((await params).collection);
  if (!parsed.success) notFound();
  return <EntityList key={parsed.data} collection={parsed.data} />;
}
