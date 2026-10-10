import { getRuntime } from "@/infrastructure/runtime";
import { handle, jsonBody } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const app = await getRuntime();
    return Response.json({ items: await app.ingestion.listBatches() });
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const app = await getRuntime();
    return Response.json(
      await app.ingestion.createBatch(await jsonBody(request)),
      { status: 201 },
    );
  });
}
