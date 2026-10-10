import type { Location } from "../../domain/ingestion/content";
import { ExtractionError } from "../../domain/ingestion/content";

export function decodeUtf8(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ExtractionError(
      "INVALID_ENCODING",
      "UTF-8이 아닌 파일입니다. 검증된 인코딩 adapter가 없어 처리하지 않습니다.",
    );
  }
  // Offsets are measured after the BOM so they match what editors display.
  const hasBom = text.startsWith("﻿");
  return {
    text: hasBom ? text.slice(1) : text,
    warnings: hasBom ? ["UTF-8 BOM을 제외하고 위치를 계산했습니다."] : [],
  };
}

export class LineIndex {
  private starts: number[] = [0];
  constructor(text: string) {
    for (let i = 0; i < text.length; i++)
      if (text[i] === "\n") this.starts.push(i + 1);
  }
  line(offset: number) {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }
  location(startOffset: number, endOffset: number): Location {
    return {
      startLine: this.line(startOffset),
      endLine: this.line(Math.max(startOffset, endOffset - 1)),
      startOffset,
      endOffset,
    };
  }
}

export function blockId(index: number) {
  return `b${String(index + 1).padStart(4, "0")}`;
}
