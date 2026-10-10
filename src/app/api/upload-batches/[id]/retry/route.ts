import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
// Requeues FAILED items with a fresh attempt budget; unsupported items are not retried.
export async function POST(_request: Request, context: Context) {
  return handle(async () => {
    const app = await getRuntime();
    return Response.json(
      await app.ingestion.retryFailed((await context.params).id),
    );
  });
}
