import type {
  ContentExtractor,
  VisionDescriber,
  VisionOcr,
} from "../../domain/ingestion/ports";
import { MarkdownExtractor } from "./markdown";
import { LogExtractor, TextExtractor } from "./plain";
import { ImageExtractor, PdfExtractor } from "./visual";

// Without OCR, images fail explicitly and scanned PDF pages are reported as skipped.
// Without a layout describer, image and PDF content is marked PARTIAL.
export function defaultExtractors(
  ocr: VisionOcr | null,
  describer: VisionDescriber | null = null,
): ContentExtractor[] {
  return [
    new MarkdownExtractor(),
    new TextExtractor(),
    new LogExtractor(),
    new PdfExtractor(ocr, describer),
    new ImageExtractor(ocr, describer),
  ];
}
