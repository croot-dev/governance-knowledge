import { regionTypes } from "../../domain/ingestion/content";
import { layoutSchema, type LayoutResult } from "../../domain/ingestion/layout";
import type {
  OcrResult,
  VisionDescriber,
  VisionOcr,
} from "../../domain/ingestion/ports";
import { NvidiaVisionOcr } from "./nvidia";

export const NO_TEXT = "[[NO_TEXT]]";
export const ILLEGIBLE = "[[ILLEGIBLE]]";

// Transcription only: the model must not summarise, translate or fill in what it cannot read.
export const OCR_PROMPT = `Transcribe all text visible in this image exactly as written.
Rules:
- Output GitHub Markdown only, with no explanation before or after.
- Keep the original language, spelling, numbers and punctuation. Do not translate, correct or summarise.
- Use Markdown headings, lists and tables only where the image shows that structure.
- Write ${ILLEGIBLE} for text that is present but cannot be read reliably. Never guess it.
- Do not describe pictures or charts.
- If the image contains no text at all, output exactly ${NO_TEXT}`;

interface ChatResponse {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
}

export interface OllamaOptions {
  timeoutMs: number;
  maxOutputTokens: number;
  contextTokens?: number;
}

export const REPETITION = {
  // A loop is the same chunk repeated this many times in a row at the end of the output...
  minRepeats: 4,
  // ...covering at least this many characters, so short legit runs (table rules, "----") pass.
  minSpan: 400,
  maxPeriod: 400,
  checkEvery: 128,
};

// Returns where the looping tail starts (keeping one copy), or -1 when the output is not looping.
export function findRepetition(text: string): number {
  for (let period = 1; period <= REPETITION.maxPeriod; period++) {
    const chunk = text.slice(-period);
    if (chunk.length < period) break;
    let end = text.length;
    let repeats = 0;
    while (end >= period && text.slice(end - period, end) === chunk) {
      repeats++;
      end -= period;
    }
    if (
      repeats >= REPETITION.minRepeats &&
      repeats * period >= REPETITION.minSpan
    )
      return end + period;
  }
  return -1;
}

// One streamed vision chat call. Streaming lets a repetition loop be cut off as soon as it
// appears instead of running to num_predict, which takes minutes on a small model.
async function ollamaChat(
  baseUrl: string,
  model: string,
  options: OllamaOptions,
  prompt: string,
  image: Uint8Array,
  format?: object,
  signal?: AbortSignal,
) {
  const stop = new AbortController();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: "user",
          content: prompt,
          images: [Buffer.from(image).toString("base64")],
        },
      ],
      ...(format ? { format } : {}),
      options: {
        // Slightly above greedy decoding, which makes small VL models loop on repeated lines.
        temperature: 0.1,
        num_predict: options.maxOutputTokens,
        // Ollama defaults to 4096 on CPU; image tokens plus output need more room.
        num_ctx: options.contextTokens ?? 8192,
      },
    }),
    signal: AbortSignal.any([
      stop.signal,
      AbortSignal.timeout(options.timeoutMs),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok)
    throw new Error(
      `OCR 서비스 HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  if (!response.body) throw new Error("OCR 응답 형식이 올바르지 않습니다.");
  let content = "";
  let checked = 0;
  let buffer = "";
  let final: ChatResponse | undefined;
  const decoder = new TextDecoder();
  const handle = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as ChatResponse & { error?: string };
    if (chunk.error)
      throw new Error(`OCR 서비스 오류: ${chunk.error.slice(0, 300)}`);
    content += chunk.message?.content ?? "";
    if (chunk.done) final = chunk;
  };
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    lines.forEach(handle);
    if (final || content.length - checked < REPETITION.checkEvery) continue;
    checked = content.length;
    const cut = findRepetition(content);
    if (cut >= 0) {
      // Dropping the connection makes Ollama stop generating.
      stop.abort();
      return {
        content: content.slice(0, cut),
        truncated: true,
        repeated: true,
      };
    }
  }
  handle(buffer + decoder.decode());
  if (!final) throw new Error("OCR 응답 형식이 올바르지 않습니다.");
  if (final.done_reason !== "stop" && final.done_reason !== "length")
    throw new Error(
      `OCR 응답이 정상 종료되지 않았습니다: ${final.done_reason}`,
    );
  return {
    content,
    truncated: final.done_reason === "length",
    repeated: false,
  };
}

export class OllamaVisionOcr implements VisionOcr {
  constructor(
    private baseUrl: string,
    public model: string,
    private options: OllamaOptions,
  ) {}

  async recognize(image: Uint8Array, signal?: AbortSignal): Promise<OcrResult> {
    const { content, truncated, repeated } = await ollamaChat(
      this.baseUrl,
      this.model,
      this.options,
      OCR_PROMPT,
      image,
      undefined,
      signal,
    );
    const markdown = stripFence(content).trim();
    if (repeated) return { status: "REPEATED", markdown, model: this.model };
    if (truncated) return { status: "TRUNCATED", markdown, model: this.model };
    if (!markdown || markdown === NO_TEXT)
      return { status: "EMPTY", markdown: "", model: this.model };
    return { status: "COMPLETE", markdown, model: this.model };
  }
}

// Interpretation, not transcription: OCR already holds the literal text.
export const LAYOUT_PROMPT = `Describe the visual layout and structure of this image.
Return JSON only, matching the given schema:
- summary: what kind of screen, document or figure this is and how it is organised (Korean, 1-3 sentences).
- regions: the main visual regions in reading order (at most 30). For each region give
  type (${regionTypes.join(", ")}), a short label (Korean),
  bbox as [x1, y1, x2, y2] integers on a 0-1000 grid of the image (top-left origin),
  and an optional one-sentence description (Korean) of what the region shows, e.g. a chart's axes and trend.
Rules:
- Describe only what is visible. Do not guess hidden values, intent or data that is not shown.
- Do not transcribe long text; labels are short names for the region.`;

// Ollama constrains the output to this JSON schema; layoutSchema re-validates it afterwards.
const LAYOUT_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    regions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...regionTypes] },
          label: { type: "string" },
          bbox: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 1000 },
            minItems: 4,
            maxItems: 4,
          },
          description: { type: "string" },
        },
        required: ["type", "label", "bbox"],
      },
    },
  },
  required: ["summary", "regions"],
};

export class OllamaLayoutDescriber implements VisionDescriber {
  constructor(
    private baseUrl: string,
    public model: string,
    private options: OllamaOptions,
  ) {}

  async describe(
    image: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LayoutResult> {
    const { content, truncated, repeated } = await ollamaChat(
      this.baseUrl,
      this.model,
      this.options,
      LAYOUT_PROMPT,
      image,
      LAYOUT_FORMAT,
      signal,
    );
    if (truncated)
      return {
        status: "TRUNCATED",
        reason: repeated
          ? "레이아웃 응답이 같은 내용을 반복해 중단했습니다."
          : "레이아웃 응답이 출력 한도에서 잘렸습니다.",
        model: this.model,
      };
    let json: unknown;
    try {
      json = JSON.parse(stripFence(content));
    } catch {
      return {
        status: "INVALID",
        reason: "레이아웃 응답이 JSON이 아닙니다.",
        model: this.model,
      };
    }
    const parsed = layoutSchema.safeParse(json);
    if (!parsed.success)
      return {
        status: "INVALID",
        reason: `레이아웃 응답이 계약과 맞지 않습니다: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
        model: this.model,
      };
    return { status: "COMPLETE", layout: parsed.data, model: this.model };
  }
}

// Models sometimes wrap the whole answer in a ```markdown fence.
export function stripFence(text: string) {
  const match = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return match ? match[1] : text;
}

function ollamaSettings(): OllamaOptions & { baseUrl: string } {
  return {
    baseUrl: process.env.OCR_OLLAMA_BASE_URL ?? "http://localhost:11434",
    timeoutMs: Number(process.env.OCR_OLLAMA_TIMEOUT_MS ?? 300000),
    maxOutputTokens: Number(process.env.OCR_MAX_OUTPUT_TOKENS ?? 4096),
    contextTokens: Number(process.env.OCR_OLLAMA_CONTEXT_TOKENS ?? 8192),
  };
}

export function createVisionOcr(): VisionOcr | null {
  const provider = process.env.OCR_PROVIDER ?? "none";
  if (provider === "none") return null;
  if (provider === "nvidia") return new NvidiaVisionOcr();
  if (provider !== "ollama")
    throw new Error("OCR_PROVIDER는 none, ollama 또는 nvidia여야 합니다.");
  const { baseUrl, ...options } = ollamaSettings();
  return new OllamaVisionOcr(
    baseUrl,
    process.env.OCR_OLLAMA_MODEL || "qwen3-vl:2b-instruct-q4_K_M",
    options,
  );
}

// Layout description runs on Ollama only; other providers report it as not configured.
export function createVisionDescriber(): VisionDescriber | null {
  if ((process.env.OCR_PROVIDER ?? "none") !== "ollama") return null;
  const { baseUrl, ...options } = ollamaSettings();
  return new OllamaLayoutDescriber(
    baseUrl,
    // `||`: compose and .env pass an unset value as "", which Ollama rejects with HTTP 400.
    process.env.OCR_OLLAMA_LAYOUT_MODEL ||
      process.env.OCR_OLLAMA_MODEL ||
      "qwen3-vl:2b-instruct-q4_K_M",
    options,
  );
}
