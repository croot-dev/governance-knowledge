import { createEmbeddingProvider } from "@/infrastructure/embedding/providers";
import { handle } from "@/infrastructure/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () =>
    Response.json({ profile: createEmbeddingProvider().profile }),
  );
}
