import type { Block, ContentDocument } from "../../domain/ingestion/content";
import type {
  ContentExtractor,
  ExtractionInput,
} from "../../domain/ingestion/ports";
import { LineIndex, blockId, decodeUtf8 } from "./text-source";

function document(
  input: ExtractionInput,
  extractor: ContentExtractor,
  format: "TEXT" | "LOG",
  blocks: Omit<Block, "id">[],
  warnings: string[],
): ContentDocument {
  return {
    schemaVersion: 1,
    itemId: input.itemId,
    sourceSha256: input.sha256,
    format,
    extractor: { name: extractor.name, version: extractor.version },
    quality: { status: "COMPLETE", warnings },
    blocks: blocks.map((b, i) => ({ ...b, id: blockId(i) })),
  };
}

// Paragraphs are runs of non-blank lines.
export function paragraphBlocks(text: string): Omit<Block, "id">[] {
  const lines = new LineIndex(text);
  return [...text.matchAll(/[^\n]*\S[^\n]*(?:\n[^\n]*\S[^\n]*)*/g)].map(
    (match) => ({
      kind: "PARAGRAPH",
      text: match[0],
      location: lines.location(match.index, match.index + match[0].length),
      origin: "EXTRACTED",
      isProtected: false,
    }),
  );
}

export class TextExtractor implements ContentExtractor {
  name = "text-paragraphs";
  version = "1";
  formats = ["TEXT"] as const;

  async extract(input: ExtractionInput) {
    const { text, warnings } = decodeUtf8(input.bytes);
    return document(input, this, "TEXT", paragraphBlocks(text), warnings);
  }
}

const TIMESTAMP =
  /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)(Z|[+-]\d{2}:?\d{2})?\b/;
const LEVEL = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/;

// One event per line; indented lines (stack traces) continue the previous event.
export class LogExtractor implements ContentExtractor {
  name = "log-lines";
  version = "1";
  formats = ["LOG"] as const;

  async extract(input: ExtractionInput) {
    const { text, warnings } = decodeUtf8(input.bytes);
    const lines = new LineIndex(text);
    const events: { start: number; end: number }[] = [];
    let offset = 0;
    for (const line of text.split("\n")) {
      const start = offset;
      const end = start + line.replace(/\r$/, "").length;
      offset += line.length + 1;
      if (!line.trim()) continue;
      const last = events.at(-1);
      if (last && /^\s/.test(line) && last.end === start - 1) last.end = end;
      else events.push({ start, end });
    }
    const blocks = events.map(({ start, end }): Omit<Block, "id"> => {
      const body = text.slice(start, end);
      const time = TIMESTAMP.exec(body);
      const level = LEVEL.exec(body.split("\n")[0])?.[1];
      return {
        kind: "LOG_EVENT",
        text: body,
        location: lines.location(start, end),
        origin: "EXTRACTED",
        isProtected: false,
        log: {
          ...(time
            ? {
                timestamp: time[1] + (time[2] ?? ""),
                timezone: time[2] ? "EXPLICIT" : "UNKNOWN",
              }
            : {}),
          ...(level ? { level } : {}),
        },
      };
    });
    if (blocks.some((b) => b.log?.timezone === "UNKNOWN"))
      warnings.push("시간대가 없는 timestamp는 원래 표현 그대로 두었습니다.");
    return document(input, this, "LOG", blocks, warnings);
  }
}
