import assert from "node:assert/strict";
import { test } from "node:test";
import { MarkdownExtractor } from "../src/infrastructure/extractors/markdown";
import {
  LogExtractor,
  TextExtractor,
} from "../src/infrastructure/extractors/plain";
import {
  ExtractionError,
  contentDocumentSchema,
  type ContentDocument,
} from "../src/domain/ingestion/content";
import {
  detectFormat,
  normalizeRelativePath,
} from "../src/domain/ingestion/intake";
import { linkStructuredValues } from "../src/domain/enrichment/linking";
import { AppError } from "../src/domain/model";

const SHA = "0".repeat(64);
const encode = (text: string) => new TextEncoder().encode(text);
const input = (text: string) => ({
  itemId: "item-1",
  relativePath: "doc.md",
  sha256: SHA,
  bytes: encode(text),
});

const markdown = [
  "# 고객 명세",
  "",
  "| 회원번호 | 주민번호 | 비고 |",
  "| --- | --- | --- |",
  "| CUST-0000000001 | 900101-1234567 | 나이스 조회 |",
  "",
  "- 회원번호: CUST-0000000002",
  "  - 나이: 34",
  "",
  "**ID**: X-1",
  "",
  "```",
  "주민번호: 850505-2345678",
  "```",
  "",
].join("\n");

// Every block and cell must point at exactly its source text; patches depend on it.
function assertLocations(source: string, document: ContentDocument) {
  for (const block of document.blocks) {
    const { startOffset, endOffset } = block.location;
    assert.equal(source.slice(startOffset, endOffset), block.text, block.id);
    for (const cell of [
      ...(block.table?.header ?? []),
      ...(block.table?.rows.flat() ?? []),
    ])
      assert.equal(
        source.slice(cell.location.startOffset, cell.location.endOffset),
        cell.text,
        cell.id,
      );
  }
}

test("Markdown 추출은 블록·표 셀의 원문 위치를 정확히 보존하고 코드를 보호한다", async () => {
  const document = await new MarkdownExtractor().extract(input(markdown));
  contentDocumentSchema.parse(document);
  assertLocations(markdown, document);
  assert.deepEqual(
    document.blocks.map((b) => [b.kind, b.depth ?? null]),
    [
      ["HEADING", 1],
      ["TABLE", null],
      ["LIST_ITEM", 1],
      ["LIST_ITEM", 2],
      ["PARAGRAPH", null],
      ["CODE", null],
    ],
  );
  const table = document.blocks[1].table!;
  assert.deepEqual(
    table.header.map((c) => c.text),
    ["회원번호", "주민번호", "비고"],
  );
  assert.equal(table.rows[0][1].id, "b0002:r1c2");
  assert.equal(table.rows[0][1].location.startLine, 5);
  assert.equal(document.blocks.at(-1)!.isProtected, true);
});

test("TXT는 빈 줄 기준 문단으로, LOG는 이벤트로 나누고 시간대를 추정하지 않는다", async () => {
  const text = "첫 문단\n이어지는 줄\n\n\n두 번째 문단\n";
  const txt = await new TextExtractor().extract(input(text));
  assertLocations(text, txt);
  assert.deepEqual(
    txt.blocks.map((b) => b.text),
    ["첫 문단\n이어지는 줄", "두 번째 문단"],
  );

  const log = [
    "2026-10-10 09:00:01 INFO started",
    "2026-10-10T09:00:02+09:00 ERROR failed",
    "    at handler (app.ts:10)",
    "no timestamp WARN line",
  ].join("\n");
  const events = await new LogExtractor().extract(input(log));
  assertLocations(log, events);
  assert.deepEqual(
    events.blocks.map((b) => b.log),
    [
      { timestamp: "2026-10-10 09:00:01", timezone: "UNKNOWN", level: "INFO" },
      {
        timestamp: "2026-10-10T09:00:02+09:00",
        timezone: "EXPLICIT",
        level: "ERROR",
      },
      { level: "WARN" },
    ],
  );
  assert.match(events.blocks[1].text, /at handler/);
  assert.ok(events.quality.warnings.length > 0);
});

test("UTF-8이 아닌 텍스트는 추측하지 않고 명시적으로 실패한다", async () => {
  await assert.rejects(
    new TextExtractor().extract({
      ...input(""),
      bytes: new Uint8Array([0xc0, 0xaf]),
    }),
    (e: unknown) =>
      e instanceof ExtractionError && e.code === "INVALID_ENCODING",
  );
});

test("표 헤더와 '라벨: 값'만 엔티티에 연결하고 모호한 라벨은 보고한다", async () => {
  const document = await new MarkdownExtractor().extract(input(markdown));
  const result = linkStructuredValues(document, [
    { text: "고객번호", termId: "t-customer" },
    { text: "회원번호", termId: "t-customer" },
    { text: "주민번호", termId: "t-rrn" },
    { text: "나이", termId: "t-age" },
    { text: "ID", termId: "t-customer" },
    { text: "id", termId: "t-contract" },
  ]);
  assert.deepEqual(
    result.links.map((l) => [l.method, l.termId, l.value]),
    [
      ["HEADER", "t-customer", "CUST-0000000001"],
      ["HEADER", "t-rrn", "900101-1234567"],
      ["KEY_VALUE", "t-customer", "CUST-0000000002"],
      ["KEY_VALUE", "t-age", "34"],
    ],
  );
  for (const link of result.links) {
    const block = document.blocks.find((b) => b.id === link.blockId)!;
    const text = link.cellId
      ? block.table!.rows.flat().find((c) => c.id === link.cellId)!.text
      : block.text;
    assert.equal(text.slice(link.span.start, link.span.end), link.value);
  }
  assert.deepEqual(result.unresolved, [
    { blockId: "b0005", label: "ID", termIds: ["t-customer", "t-contract"] },
  ]);
});

test("경로는 상대 경로로 정규화하고 이동·절대 경로를 거부한다", () => {
  assert.equal(normalizeRelativePath("a\\b/./c.md"), "a/b/c.md");
  for (const bad of [
    "../x.md",
    "/etc/passwd",
    "C:/x.md",
    "a/../../x",
    "a\u0000b",
  ])
    assert.throws(() => normalizeRelativePath(bad), AppError, bad);
});

test("형식은 확장자와 실제 내용이 모두 맞아야 인정한다", () => {
  const pdf = encode("%PDF-1.7");
  assert.equal(detectFormat("a.pdf", pdf).format, "PDF");
  assert.equal(detectFormat("a.pdf", encode("hello")).format, null);
  assert.equal(detectFormat("a.md", pdf).format, null);
  assert.equal(detectFormat("a.docx", encode("x")).format, null);
  assert.equal(detectFormat("a.LOG", encode("x")).format, "LOG");
});
