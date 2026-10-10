import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ExtractionError,
  type Block,
  type ContentDocument,
} from "../../domain/ingestion/content";
import type {
  ContentExtractor,
  ExtractionInput,
  VisionDescriber,
  VisionOcr,
} from "../../domain/ingestion/ports";
import { ILLEGIBLE } from "../ocr/ollama";
import { assignIds, parseMarkdownDrafts, type BlockDraft } from "./markdown";
import { prepareForOcr, splitForOcr } from "./image-prep";
import { paragraphBlocks } from "./plain";

const run = promisify(execFile);

export const PDF_LIMITS = {
  maxPages: Number(process.env.PDF_MAX_PAGES ?? 100),
  renderDpi: Number(process.env.PDF_RENDER_DPI ?? 150),
  // Fewer visible characters than this means the page is treated as scanned.
  minTextLayerChars: 20,
  commandTimeoutMs: 60000,
};

interface PageResult {
  drafts: BlockDraft[];
  warnings: string[];
  isPartial: boolean;
}

const pageLabel = (page: number) => `${page}쪽`;

// Strips overlap, so the lines that open a strip may repeat the lines that closed the previous one.
export function joinTranscripts(parts: string[]): string {
  const MAX_OVERLAP_LINES = 8;
  const norm = (line: string) => line.trim().replace(/\s+/g, " ");
  let lines: string[] = [];
  for (const part of parts) {
    const next = part.split("\n");
    const prevTail = lines.filter((l) => l.trim()).map(norm);
    const nextHead = next.filter((l) => l.trim()).map(norm);
    let overlap = 0;
    for (
      let k = Math.min(MAX_OVERLAP_LINES, prevTail.length, nextHead.length);
      k > 0;
      k--
    )
      if (prevTail.slice(-k).join("\n") === nextHead.slice(0, k).join("\n")) {
        overlap = k;
        break;
      }
    // Drop the first `overlap` non-blank lines of the next strip.
    let skipped = 0;
    const rest = next.filter((line) => {
      if (skipped >= overlap || !line.trim()) return skipped >= overlap;
      skipped++;
      return false;
    });
    lines = lines.length ? [...lines, "", ...rest] : rest;
  }
  return lines.join("\n").trim();
}

// OCR blocks keep offsets into the page transcript, never into the binary original.
async function ocrPage(
  ocr: VisionOcr,
  image: Uint8Array,
  page: number,
  signal?: AbortSignal,
  heartbeat?: () => Promise<void>,
): Promise<PageResult> {
  const tiles = await splitForOcr(image);
  const label = (i: number) =>
    tiles.length > 1
      ? `${pageLabel(page)} ${i + 1}/${tiles.length}조각`
      : pageLabel(page);
  const transcripts: string[] = [];
  const warnings: string[] = [];
  let isPartial = false;
  for (const [i, tile] of tiles.entries()) {
    if (i > 0) await heartbeat?.();
    const result = await ocr.recognize(tile, signal);
    if (result.status === "TRUNCATED") {
      warnings.push(
        `${label(i)}: OCR 출력이 한도에서 잘려 결과를 채택하지 않았습니다.`,
      );
      isPartial = true;
    } else if (result.status === "REPEATED") {
      // The text before the loop is a real transcription; only the looping tail is dropped.
      if (result.markdown) transcripts.push(result.markdown);
      warnings.push(
        `${label(i)}: OCR 출력이 반복되어 중단했고 반복 이전까지만 채택했습니다.`,
      );
      isPartial = true;
    } else if (result.status === "COMPLETE") transcripts.push(result.markdown);
  }
  if (!transcripts.length && !isPartial)
    return {
      drafts: [],
      warnings: [`${pageLabel(page)}: 인식된 텍스트가 없습니다.`],
      isPartial: false,
    };
  const markdown = joinTranscripts(transcripts);
  const drafts = parseMarkdownDrafts(markdown).map((d) => ({
    ...d,
    origin: "OCR" as const,
    location: { ...d.location, page },
  }));
  const illegible = markdown.split(ILLEGIBLE).length - 1;
  if (illegible)
    warnings.push(`${pageLabel(page)}: 판독 불가 표시 ${illegible}건`);
  if (tiles.length > 1)
    warnings.push(
      `${pageLabel(page)}: 이미지를 ${tiles.length}조각으로 나눠 OCR한 뒤 합쳤습니다.`,
    );
  return { drafts, warnings, isPartial };
}

// Interpretation blocks carry no source offsets; they point at the page and an image region.
async function layoutPage(
  describer: VisionDescriber | null,
  image: Uint8Array | null,
  page: number,
  signal?: AbortSignal,
): Promise<PageResult> {
  if (!describer || !image)
    return {
      drafts: [],
      warnings: [
        `${pageLabel(page)}: 레이아웃 설명 엔진이 구성되지 않아 건너뛰었습니다.`,
      ],
      isPartial: true,
    };
  let result;
  try {
    result = await describer.describe(image, signal);
  } catch (error) {
    // Layout is supplementary: its failure must not discard the OCR text or retry the whole item.
    if (signal?.aborted) throw error;
    return {
      drafts: [],
      warnings: [
        `${pageLabel(page)}: 레이아웃 설명 실패 - ${(error as Error).message.slice(0, 200)}`,
      ],
      isPartial: true,
    };
  }
  if (result.status !== "COMPLETE")
    return {
      drafts: [],
      warnings: [`${pageLabel(page)}: ${result.reason}`],
      isPartial: true,
    };
  const location = {
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    endOffset: 0,
    page,
  };
  const base = {
    location,
    origin: "INFERRED" as const,
    isProtected: true,
  };
  return {
    drafts: [
      {
        ...base,
        kind: "VISUAL_SUMMARY",
        text: result.layout.summary,
        visual: { model: result.model },
      },
      ...result.layout.regions.map((region): BlockDraft => ({
        ...base,
        kind: "VISUAL_REGION",
        text: region.description
          ? `${region.label}: ${region.description}`
          : region.label,
        visual: {
          regionType: region.type,
          label: region.label,
          bbox: region.bbox,
          model: result.model,
        },
      })),
    ],
    warnings: [],
    isPartial: false,
  };
}

function merge(...parts: PageResult[]): PageResult {
  return {
    drafts: parts.flatMap((p) => p.drafts),
    warnings: parts.flatMap((p) => p.warnings),
    isPartial: parts.some((p) => p.isPartial),
  };
}

function versionFor(ocr: VisionOcr | null, describer: VisionDescriber | null) {
  const clean = (model?: string) =>
    (model ?? "none").replace(/[^A-Za-z0-9._-]/g, "_");
  return `2-${clean(ocr?.model)}-layout-${clean(describer?.model)}`;
}

function document(
  input: ExtractionInput,
  extractor: ContentExtractor,
  format: "PDF" | "IMAGE",
  pages: PageResult[],
  extraWarnings: string[] = [],
): ContentDocument {
  const isPartial = pages.some((p) => p.isPartial);
  return {
    schemaVersion: 1,
    itemId: input.itemId,
    sourceSha256: input.sha256,
    format,
    extractor: { name: extractor.name, version: extractor.version },
    quality: {
      status: isPartial ? "PARTIAL" : "COMPLETE",
      warnings: [
        "OCR 블록은 원문이 아닌 인식 결과이며 위치는 쪽별 인식 텍스트 기준입니다.",
        "VISUAL_* 블록은 모델이 해석한 레이아웃 설명(INFERRED)이며 원문 근거가 아닙니다. 좌표는 이미지 기준 0–1000입니다.",
        ...extraWarnings,
        ...pages.flatMap((p) => p.warnings),
      ],
    },
    blocks: assignIds(pages.flatMap((p) => p.drafts)),
  };
}

export class ImageExtractor implements ContentExtractor {
  name = "image-ocr";
  version: string;
  formats = ["IMAGE"] as const;
  constructor(
    private ocr: VisionOcr | null,
    private describer: VisionDescriber | null = null,
  ) {
    this.version = versionFor(ocr, describer);
  }

  async extract(input: ExtractionInput) {
    if (!this.ocr)
      throw new ExtractionError(
        "ENGINE_NOT_CONFIGURED",
        "OCR 엔진이 구성되지 않았습니다 (OCR_PROVIDER).",
      );
    const image = await prepareForOcr(input.bytes);
    const text = await ocrPage(
      this.ocr,
      image,
      1,
      input.signal,
      input.heartbeat,
    );
    await input.heartbeat?.();
    const layout = await layoutPage(this.describer, image, 1, input.signal);
    return document(input, this, "IMAGE", [merge(text, layout)]);
  }
}

// Each page uses its text layer when present (OCR otherwise), and every page is rendered for layout.
export class PdfExtractor implements ContentExtractor {
  name = "pdf-poppler";
  version: string;
  formats = ["PDF"] as const;
  constructor(
    private ocr: VisionOcr | null,
    private describer: VisionDescriber | null = null,
  ) {
    this.version = versionFor(ocr, describer);
  }

  async extract(input: ExtractionInput) {
    const dir = await mkdtemp(join(tmpdir(), "pdf-extract-"));
    try {
      const file = join(dir, "source.pdf");
      await writeFile(file, input.bytes);
      const pageCount = await this.pageCount(file);
      const pages: PageResult[] = [];
      let ocrPages = 0;
      for (let page = 1; page <= pageCount; page++) {
        input.signal?.throwIfAborted();
        const result = await this.page(file, dir, page, input);
        if (result.drafts.some((d) => d.origin === "OCR")) ocrPages++;
        pages.push(result);
        await input.heartbeat?.();
      }
      return document(input, this, "PDF", pages, [
        `총 ${pageCount}쪽, OCR 처리 ${ocrPages}쪽`,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async pageCount(file: string) {
    let info: string;
    try {
      info = (
        await run("pdfinfo", [file], { timeout: PDF_LIMITS.commandTimeoutMs })
      ).stdout;
    } catch (error) {
      throw new ExtractionError(
        "CORRUPT_FILE",
        `PDF 정보를 읽을 수 없습니다: ${(error as Error).message.slice(0, 200)}`,
      );
    }
    if (/^Encrypted:\s+yes/m.test(info))
      throw new ExtractionError(
        "UNSUPPORTED_FORMAT",
        "암호화된 PDF는 지원하지 않습니다.",
      );
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!pages)
      throw new ExtractionError(
        "CORRUPT_FILE",
        "PDF 쪽 수를 확인할 수 없습니다.",
      );
    if (pages > PDF_LIMITS.maxPages)
      throw new ExtractionError(
        "LIMIT_EXCEEDED",
        `PDF 쪽 수(${pages})가 한도(${PDF_LIMITS.maxPages})를 넘습니다.`,
      );
    return pages;
  }

  private async render(file: string, dir: string, page: number) {
    const prefix = join(dir, `page-${page}`);
    await run(
      "pdftoppm",
      [
        "-f",
        String(page),
        "-l",
        String(page),
        "-r",
        String(PDF_LIMITS.renderDpi),
        "-png",
        "-singlefile",
        file,
        prefix,
      ],
      { timeout: PDF_LIMITS.commandTimeoutMs },
    );
    return prepareForOcr(new Uint8Array(await readFile(`${prefix}.png`)));
  }

  private async page(
    file: string,
    dir: string,
    page: number,
    input: ExtractionInput,
  ): Promise<PageResult> {
    const { stdout } = await run(
      "pdftotext",
      ["-f", String(page), "-l", String(page), "-enc", "UTF-8", file, "-"],
      { timeout: PDF_LIMITS.commandTimeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    const text = stdout.replace(/\f/g, "");
    const hasTextLayer =
      text.replace(/\s/g, "").length >= PDF_LIMITS.minTextLayerChars;
    const needsImage = !!this.describer || (!hasTextLayer && !!this.ocr);
    const image = needsImage ? await this.render(file, dir, page) : null;

    let content: PageResult;
    if (hasTextLayer)
      content = {
        drafts: paragraphBlocks(text).map((b): Omit<Block, "id"> => ({
          ...b,
          location: { ...b.location, page },
        })),
        warnings: [],
        isPartial: false,
      };
    else if (this.ocr && image)
      content = await ocrPage(
        this.ocr,
        image,
        page,
        input.signal,
        input.heartbeat,
      );
    else
      content = {
        drafts: [],
        warnings: [
          `${pageLabel(page)}: 텍스트 레이어가 없고 OCR 엔진이 구성되지 않아 건너뛰었습니다.`,
        ],
        isPartial: true,
      };
    // OCR and layout are separate model calls; keep the job lease alive between them.
    if (image) await input.heartbeat?.();
    return merge(
      content,
      await layoutPage(this.describer, image, page, input.signal),
    );
  }
}
