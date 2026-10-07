import { collectionSchema } from "@/domain/validation";
import { getRuntime } from "@/infrastructure/runtime";
import { handle, jsonBody } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ collection: string; id: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const { collection, id } = await context.params;
    const app = await getRuntime();
    return Response.json(
      await app.governance.get(collectionSchema.parse(collection), id),
    );
  });
}
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const { collection, id } = await context.params;
    const app = await getRuntime();
    return Response.json(
      await app.governance.update(
        collectionSchema.parse(collection),
        id,
        await jsonBody(request),
      ),
    );
  });
}
export async function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    const { collection, id } = await context.params;
    const app = await getRuntime();
    await app.governance.delete(collectionSchema.parse(collection), id);
    return new Response(null, { status: 204 });
  });
}
