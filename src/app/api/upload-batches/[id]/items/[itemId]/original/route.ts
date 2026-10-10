import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; itemId: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const { id, itemId } = await context.params;
    const app = await getRuntime();
    const { bytes, type } = await app.ingestion.originalImage(id, itemId);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
