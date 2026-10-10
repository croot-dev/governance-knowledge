import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; itemId: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const { id, itemId } = await context.params;
    const app = await getRuntime();
    return Response.json(await app.links.links(id, itemId));
  });
}
