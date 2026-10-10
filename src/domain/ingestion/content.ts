import { z } from "zod";

export const sourceFormats = [
  "MARKDOWN",
  "TEXT",
  "LOG",
  "PDF",
  "IMAGE",
  "ZIP",
] as const;
export type SourceFormat = (typeof sourceFormats)[number];

// Lines are 1-based; offsets are 0-based UTF-16 indexes into the decoded source text.
export const locationSchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0),
    page: z.number().int().min(1).optional(),
  })
  .strict();
export type Location = z.infer<typeof locationSchema>;

const cellSchema = z
  .object({ id: z.string(), text: z.string(), location: locationSchema })
  .strict();
export type Cell = z.infer<typeof cellSchema>;

export const blockKinds = [
  "HEADING",
  "PARAGRAPH",
  "LIST_ITEM",
  "QUOTE",
  "TABLE",
  "CODE",
  "HTML",
  "LINE",
  "LOG_EVENT",
  // Vision-model interpretation of a page or image; always origin INFERRED.
  "VISUAL_SUMMARY",
  "VISUAL_REGION",
] as const;

export const regionTypes = [
  "HEADER",
  "NAVIGATION",
  "SIDEBAR",
  "TAB",
  "FORM",
  "TABLE",
  "CHART",
  "IMAGE",
  "TEXT",
  "BUTTON",
  "LIST",
  "CARD",
  "FOOTER",
  "OTHER",
] as const;

// [x1, y1, x2, y2] on a 0–1000 grid of the analysed image, so it maps onto any rendered size.
export const bboxSchema = z
  .tuple([
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
  ])
  .refine(
    ([x1, y1, x2, y2]) => x1 < x2 && y1 < y2,
    "bbox 좌표 순서가 올바르지 않습니다.",
  );

// EXTRACTED is source text; OCR and INFERRED (vision) must never be presented as original text.
export const origins = ["EXTRACTED", "OCR", "INFERRED"] as const;

export const blockSchema = z
  .object({
    id: z.string(),
    kind: z.enum(blockKinds),
    text: z.string(),
    location: locationSchema,
    origin: z.enum(origins),
    // Code, HTML and similar blocks must keep their literal text in any enrichment.
    isProtected: z.boolean(),
    depth: z.number().int().min(1).optional(),
    table: z
      .object({
        header: z.array(cellSchema),
        rows: z.array(z.array(cellSchema)),
      })
      .strict()
      .optional(),
    log: z
      .object({
        // The raw time text is kept; a missing zone is never filled in.
        timestamp: z.string().optional(),
        timezone: z.enum(["EXPLICIT", "UNKNOWN"]).optional(),
        level: z.string().optional(),
      })
      .strict()
      .optional(),
    visual: z
      .object({
        regionType: z.enum(regionTypes).optional(),
        label: z.string().max(200).optional(),
        bbox: bboxSchema.optional(),
        model: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (b) => !b.visual || (b.origin === "INFERRED" && b.isProtected),
    "시각 해석 블록은 INFERRED이고 보호 구간이어야 합니다.",
  );
export type Block = z.infer<typeof blockSchema>;

export const contentDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    itemId: z.string(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    format: z.enum(sourceFormats),
    extractor: z.object({ name: z.string(), version: z.string() }).strict(),
    quality: z
      .object({
        status: z.enum(["COMPLETE", "PARTIAL"]),
        warnings: z.array(z.string()),
      })
      .strict(),
    blocks: z.array(blockSchema),
  })
  .strict();
export type ContentDocument = z.infer<typeof contentDocumentSchema>;

export class ExtractionError extends Error {
  constructor(
    public code:
      | "INVALID_ENCODING"
      | "ENGINE_NOT_CONFIGURED"
      | "UNSUPPORTED_FORMAT"
      | "CORRUPT_FILE"
      | "LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
  }
}
