import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const app = await getRuntime();
    const scheme = params.get("scheme") ?? undefined;
    const atLeast = params.get("atLeast");
    return Response.json({
      items: atLeast
        ? await app.catalog.gradeRange({ gradeSchemeId: scheme, atLeast })
        : await app.catalog.jobGrades(scheme),
    });
  });
}
