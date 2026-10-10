import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; version: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const { id, version } = await context.params;
    const app = await getRuntime();
    return Response.json(await app.catalog.ruleVersion(id, version));
  });
}
