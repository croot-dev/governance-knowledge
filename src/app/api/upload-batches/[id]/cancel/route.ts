import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
// Stops pending and running jobs; stopped items can be resumed with the retry endpoint.
export async function POST(_request: Request, context: Context) {
  return handle(async () => {
    const app = await getRuntime();
    return Response.json(await app.ingestion.cancel((await context.params).id));
  });
}
