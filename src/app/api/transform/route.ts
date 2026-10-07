import { AppError } from "@/domain/model";
import { MAX_DOCUMENT_BYTES } from "@/application/transform";
import { getRuntime } from "@/infrastructure/runtime";
import { handle } from "@/infrastructure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Multipart framing overhead on top of the document limit.
const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;
export async function POST(request: Request) {
  return handle(async () => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_REQUEST_BYTES)
      throw new AppError(413, "FILE_TOO_LARGE", "파일은 1MB 이하여야 합니다.");
    const form = await request.formData().catch(() => {
      throw new AppError(
        400,
        "INVALID_FORM",
        "multipart/form-data 요청이 필요합니다.",
      );
    });
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError(
        400,
        "FILE_REQUIRED",
        "업로드할 .md 파일이 필요합니다.",
      );
    const app = await getRuntime();
    // The uploaded document may contain personal data, so it is transformed in memory and never stored.
    return Response.json(
      await app.transform.transform(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      ),
    );
  });
}
