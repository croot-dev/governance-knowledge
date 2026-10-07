import { ZodError } from "zod";
import { AppError } from "../domain/model";
export async function jsonBody(request: Request) {
  const text = await request.text();
  if (text.length > 100000)
    throw new AppError(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "올바른 JSON 요청이 필요합니다.");
  }
}
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "입력값을 확인해주세요.",
            details: error.issues,
          },
        },
        { status: 400 },
      );
    if (error instanceof AppError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    const code = (error as { code?: string }).code;
    if (code === "23505")
      return Response.json(
        {
          error: {
            code: "DUPLICATE",
            message:
              "같은 도메인의 용어명 또는 같은 Term의 표현이 이미 존재합니다.",
          },
        },
        { status: 409 },
      );
    if (code === "23503")
      return Response.json(
        {
          error: {
            code: "RELATION_CONFLICT",
            message: "연결된 데이터의 상태를 확인해주세요.",
          },
        },
        { status: 409 },
      );
    console.error(error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "저장소에 연결할 수 없거나 처리를 완료하지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }
}
