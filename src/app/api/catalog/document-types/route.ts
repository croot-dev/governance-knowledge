import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const app = await getRuntime();
    return Response.json({ items: await app.catalog.documentTypes() });
  });
}
