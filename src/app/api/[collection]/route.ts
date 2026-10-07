import { collectionSchema } from "@/domain/validation";
import { getRuntime } from "@/infrastructure/runtime";
import { handle, jsonBody } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ collection: string }> };
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const collection = collectionSchema.parse(
      (await context.params).collection,
    );
    const app = await getRuntime();
    return Response.json(
      await app.governance.list(
        collection,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    const collection = collectionSchema.parse(
      (await context.params).collection,
    );
    const app = await getRuntime();
    return Response.json(
      await app.governance.create(collection, await jsonBody(request)),
      { status: 201 },
    );
  });
}
