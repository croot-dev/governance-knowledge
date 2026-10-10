import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { AppError } from "@/domain/model";
import { LIMITS } from "@/domain/ingestion/intake";
import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
// Raw body upload: POST ?path=<relative path>. The body streams to storage without buffering.
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    const path = new URL(request.url).searchParams.get("path");
    if (!path)
      throw new AppError(
        400,
        "PATH_REQUIRED",
        "path 쿼리 파라미터가 필요합니다.",
      );
    if (
      Number(request.headers.get("content-length") ?? 0) > LIMITS.maxFileBytes
    )
      throw new AppError(413, "FILE_TOO_LARGE", "파일 크기 한도를 넘었습니다.");
    if (!request.body)
      throw new AppError(
        400,
        "BODY_REQUIRED",
        "업로드할 파일 내용이 필요합니다.",
      );
    const app = await getRuntime();
    return Response.json(
      await app.ingestion.addItem(
        (await context.params).id,
        path,
        Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>),
      ),
      { status: 201 },
    );
  });
}
