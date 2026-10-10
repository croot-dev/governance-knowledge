import { AppError } from "../model";
import type { SourceFormat } from "./content";

// PoC defaults; production values are fixed after evaluation (plan stage 0~2).
export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxBatchItems: 2000,
  maxPathLength: 512,
  maxPathDepth: 16,
  archive: {
    maxBytes: 200 * 1024 * 1024,
    maxEntries: 1000,
    maxTotalBytes: 500 * 1024 * 1024,
    // Entries expanding beyond this ratio are treated as a decompression bomb.
    maxRatio: 100,
  },
} as const;

export const batchModes = ["FILES", "FOLDER", "ZIP"] as const;
export type BatchMode = (typeof batchModes)[number];

export const itemStatuses = [
  "UPLOADING",
  "STORED",
  "READY",
  "EXTRACTED",
  "UNSUPPORTED",
  "FAILED",
  "CANCELLED",
] as const;
export type ItemStatus = (typeof itemStatuses)[number];

// Relative paths are display metadata only; storage keys never derive from them.
export function normalizeRelativePath(input: string): string {
  const fail = (message: string): never => {
    throw new AppError(400, "INVALID_PATH", message);
  };
  const path = input.normalize("NFC").replace(/\\/g, "/");
  if (!path.trim()) fail("파일 경로가 필요합니다.");
  if (path.length > LIMITS.maxPathLength) fail("파일 경로가 너무 깁니다.");
  if (/[\u0000-\u001f\u007f]/.test(path)) fail("경로에 제어 문자가 있습니다.");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path))
    fail("절대 경로는 허용하지 않습니다.");
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === ".."))
    fail("상위 경로 이동은 허용하지 않습니다.");
  if (!segments.length) fail("파일 경로가 필요합니다.");
  if (segments.length > LIMITS.maxPathDepth)
    fail("폴더 깊이가 한도를 넘습니다.");
  return segments.join("/");
}

const EXTENSION_FORMATS: Record<string, SourceFormat> = {
  md: "MARKDOWN",
  markdown: "MARKDOWN",
  txt: "TEXT",
  log: "LOG",
  pdf: "PDF",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
  zip: "ZIP",
};
const BINARY_FORMATS = new Set<SourceFormat>(["PDF", "IMAGE", "ZIP"]);

function sniff(head: Uint8Array): SourceFormat | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return "PDF";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "IMAGE";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "IMAGE";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "IMAGE";
  if (ascii(0, 4) === "PK\u0003\u0004" || ascii(0, 4) === "PK\u0005\u0006")
    return "ZIP";
  return null;
}

// The extension proposes a format; binary formats must also match their magic bytes.
export function detectFormat(
  relativePath: string,
  head: Uint8Array,
): { format: SourceFormat | null; reason?: string } {
  const extension = relativePath.split(".").at(-1)?.toLowerCase() ?? "";
  const claimed = EXTENSION_FORMATS[extension];
  const actual = sniff(head);
  if (!claimed)
    return {
      format: null,
      reason: `지원하지 않는 확장자입니다: .${extension}`,
    };
  if (BINARY_FORMATS.has(claimed)) {
    if (actual !== claimed)
      return {
        format: null,
        reason: "확장자와 실제 파일 형식이 일치하지 않습니다.",
      };
    return { format: claimed };
  }
  if (actual)
    return {
      format: null,
      reason: "텍스트 확장자이지만 실제 내용은 바이너리 형식입니다.",
    };
  return { format: claimed };
}
