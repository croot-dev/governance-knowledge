import type { VisionOcr, OcrResult } from "../../domain/ingestion/ports";
import { NvidiaClient, positiveInt } from "../nvidia/client";
import { OCR_PROMPT, NO_TEXT, stripFence } from "./ollama";

export class NvidiaVisionOcr implements VisionOcr {
  constructor(
    private client = new NvidiaClient(),
    public model = process.env.OCR_NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b",
    private maxTokens = positiveInt("OCR_MAX_OUTPUT_TOKENS", 4096),
  ) {}

  async recognize(image: Uint8Array): Promise<OcrResult> {
    const mime =
      image[0] === 0x89 && image[1] === 0x50
        ? "image/png"
        : image[0] === 0xff && image[1] === 0xd8
          ? "image/jpeg"
          : Buffer.from(image.subarray(0, 4)).toString() === "RIFF" &&
              Buffer.from(image.subarray(8, 12)).toString() === "WEBP"
            ? "image/webp"
            : null;
    if (!mime) throw new Error("NVIDIA OCR 입력은 PNG/JPEG/WebP여야 합니다.");
    const data = await this.client.post<{
      choices?: { finish_reason?: string; message?: { content?: string } }[];
    }>("chat/completions", {
      model: this.model,
      stream: false,
      temperature: 0,
      max_tokens: this.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${Buffer.from(image).toString("base64")}`,
              },
            },
          ],
        },
      ],
    });
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length")
      return { status: "TRUNCATED", markdown: "", model: this.model };
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice.message?.content !== "string"
    )
      throw new Error("NVIDIA OCR 응답이 정상 종료되지 않았습니다.");
    const markdown = stripFence(choice.message.content).trim();
    if (!markdown) throw new Error("NVIDIA OCR이 빈 응답을 반환했습니다.");
    return {
      status: markdown === NO_TEXT ? "EMPTY" : "COMPLETE",
      markdown: markdown === NO_TEXT ? "" : markdown,
      model: this.model,
    };
  }
}
