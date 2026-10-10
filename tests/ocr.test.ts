import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { makePdf } from "./helpers/pdf";
import { splitForOcr } from "../src/infrastructure/extractors/image-prep";
import {
  joinTranscripts,
  ImageExtractor,
  PDF_LIMITS,
  PdfExtractor,
} from "../src/infrastructure/extractors/visual";
import {
  findRepetition,
  OllamaLayoutDescriber,
  OllamaVisionOcr,
} from "../src/infrastructure/ocr/ollama";
import {
  ExtractionError,
  contentDocumentSchema,
} from "../src/domain/ingestion/content";
import type {
  OcrResult,
  VisionDescriber,
  VisionOcr,
} from "../src/domain/ingestion/ports";
import type { Layout, LayoutResult } from "../src/domain/ingestion/layout";

const hasPoppler = (() => {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

class FakeOcr implements VisionOcr {
  model = "fake:ocr";
  images: Uint8Array[] = [];
  constructor(private result: Omit<OcrResult, "model">) {}
  async recognize(image: Uint8Array) {
    this.images.push(image);
    return { ...this.result, model: this.model };
  }
}

const sampleLayout: Layout = {
  summary: "표 하나가 있는 문서 화면",
  regions: [
    {
      type: "TABLE",
      label: "고객 표",
      bbox: [100, 200, 900, 600],
      description: "회원번호·주민번호 열",
    },
  ],
};
class FakeDescriber implements VisionDescriber {
  model = "fake:layout";
  images: Uint8Array[] = [];
  constructor(
    private result: (() => LayoutResult) | null = () => ({
      status: "COMPLETE",
      layout: sampleLayout,
      model: this.model,
    }),
  ) {}
  async describe(image: Uint8Array) {
    this.images.push(image);
    return this.result!();
  }
}

const input = (bytes: Uint8Array) => ({
  itemId: "item-1",
  relativePath: "scan.pdf",
  sha256: "0".repeat(64),
  bytes,
});
const png = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer(),
  );
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;

test(
  "PDF는 텍스트 레이어가 있는 쪽은 원문으로, 없는 쪽만 렌더링해 OCR한다",
  { skip: !hasPoppler },
  async () => {
    const ocr = new FakeOcr({
      status: "COMPLETE",
      markdown: "| 주민번호 |\n| --- |\n| 850505-2345678 |",
    });
    const describer = new FakeDescriber();
    let beats = 0;
    const document = await new PdfExtractor(ocr, describer).extract({
      ...input(makePdf(["Customer report page one\nRRN 900101-1234567", null])),
      heartbeat: async () => {
        beats++;
      },
    });
    contentDocumentSchema.parse(document);
    // Only the scanned page is OCRed (in strips), but every page is rendered whole for its layout.
    const page = await sharp(describer.images[1]).metadata();
    assert.equal(
      ocr.images.length,
      Math.ceil((page.height! - 64) / (800 - 64)),
    );
    assert.ok(ocr.images.every(isPng));
    assert.equal(describer.images.length, 2);
    // One beat per page, one between OCR and layout, and one between strips.
    assert.equal(beats, 4 + ocr.images.length - 1);
    assert.deepEqual(
      document.blocks.map((b) => [b.kind, b.origin, b.location.page]),
      [
        ["PARAGRAPH", "EXTRACTED", 1],
        ["VISUAL_SUMMARY", "INFERRED", 1],
        ["VISUAL_REGION", "INFERRED", 1],
        ["TABLE", "OCR", 2],
        ["VISUAL_SUMMARY", "INFERRED", 2],
        ["VISUAL_REGION", "INFERRED", 2],
      ],
    );
    assert.match(document.blocks[0].text, /900101-1234567/);
    assert.equal(document.blocks[3].table!.rows[0][0].text, "850505-2345678");
    assert.equal(document.quality.status, "COMPLETE");
    assert.equal(document.extractor.version, "2-fake_ocr-layout-fake_layout");
  },
);

test(
  "OCR이 없거나 응답이 잘린 쪽은 결과로 채택하지 않고 PARTIAL로 표시한다",
  { skip: !hasPoppler },
  async () => {
    const pdf = makePdf(["A page with a real text layer here", null]);
    const withoutOcr = await new PdfExtractor(null).extract(input(pdf));
    assert.equal(withoutOcr.quality.status, "PARTIAL");
    assert.ok(withoutOcr.quality.warnings.some((w) => w.startsWith("2쪽")));
    assert.equal(withoutOcr.blocks.length, 1);

    const truncated = await new PdfExtractor(
      new FakeOcr({ status: "TRUNCATED", markdown: "| 잘린 표" }),
    ).extract(input(pdf));
    assert.equal(truncated.quality.status, "PARTIAL");
    assert.ok(truncated.blocks.every((b) => b.origin === "EXTRACTED"));
  },
);

test(
  "손상·과다 쪽수 PDF는 명시적 오류로 실패한다",
  { skip: !hasPoppler },
  async () => {
    const extractor = new PdfExtractor(null);
    await assert.rejects(
      extractor.extract(input(new TextEncoder().encode("%PDF-1.7 broken"))),
      (e: unknown) => e instanceof ExtractionError && e.code === "CORRUPT_FILE",
    );
    const max = PDF_LIMITS.maxPages;
    PDF_LIMITS.maxPages = 1;
    try {
      await assert.rejects(
        extractor.extract(input(makePdf(["one page of text content", null]))),
        (e: unknown) =>
          e instanceof ExtractionError && e.code === "LIMIT_EXCEEDED",
      );
    } finally {
      PDF_LIMITS.maxPages = max;
    }
  },
);

test("이미지는 OCR 결과를 블록으로 만들고 판독 불가 표시를 경고로 남긴다", async () => {
  const image = await png(400, 200);
  const document = await new ImageExtractor(
    new FakeOcr({
      status: "COMPLETE",
      markdown: "# 신청서\n\n성명: [[ILLEGIBLE]]",
    }),
  ).extract(input(image));
  assert.deepEqual(
    document.blocks.map((b) => [b.kind, b.origin, b.location.page]),
    [
      ["HEADING", "OCR", 1],
      ["PARAGRAPH", "OCR", 1],
    ],
  );
  assert.ok(
    document.quality.warnings.some((w) => w.includes("판독 불가 표시 1건")),
  );
  await assert.rejects(
    new ImageExtractor(null).extract(input(image)),
    (e: unknown) =>
      e instanceof ExtractionError && e.code === "ENGINE_NOT_CONFIGURED",
  );
});

test("Ollama 어댑터는 종료 사유를 정규화하고 잘린 출력을 완료로 취급하지 않는다", async () => {
  const original = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  const ocr = new OllamaVisionOcr(
    "http://ollama:11434/",
    "qwen3-vl:2b-instruct-q4_K_M",
    {
      timeoutMs: 1000,
      maxOutputTokens: 512,
    },
  );
  const image = new Uint8Array([1, 2, 3]);
  try {
    respond({
      done: true,
      done_reason: "stop",
      message: { content: "```markdown\n# 제목\n```" },
    });
    assert.deepEqual(await ocr.recognize(image), {
      status: "COMPLETE",
      markdown: "# 제목",
      model: "qwen3-vl:2b-instruct-q4_K_M",
    });
    const sent = requests[0] as {
      model: string;
      stream: boolean;
      messages: { images: string[] }[];
      options: { temperature: number; num_predict: number };
    };
    assert.equal(sent.model, "qwen3-vl:2b-instruct-q4_K_M");
    assert.equal(sent.stream, true);
    assert.deepEqual(sent.messages[0].images, ["AQID"]);
    assert.deepEqual(sent.options, {
      temperature: 0.1,
      num_predict: 512,
      num_ctx: 8192,
    });

    respond({
      done: true,
      done_reason: "length",
      message: { content: "| 잘림" },
    });
    assert.equal((await ocr.recognize(image)).status, "TRUNCATED");
    respond({
      done: true,
      done_reason: "stop",
      message: { content: "[[NO_TEXT]]" },
    });
    assert.equal((await ocr.recognize(image)).status, "EMPTY");
    respond({ done: true, done_reason: "unload", message: { content: "x" } });
    await assert.rejects(ocr.recognize(image), /정상 종료/);
    respond({ error: "model not found" }, 404);
    await assert.rejects(ocr.recognize(image), /HTTP 404/);
  } finally {
    globalThis.fetch = original;
  }
});

test("큰 이미지는 OCR 전에 긴 변 1600px 이하로 줄이고, 손상 이미지는 명시적으로 실패한다", async () => {
  const ocr = new FakeOcr({ status: "EMPTY", markdown: "" });
  await new ImageExtractor(ocr).extract(input(await png(3200, 1200)));
  const sent = await sharp(ocr.images[0]).metadata();
  assert.deepEqual([sent.width, sent.height], [1600, 600]);

  await new ImageExtractor(ocr).extract(input(await png(800, 600)));
  const small = await sharp(ocr.images[1]).metadata();
  assert.deepEqual([small.width, small.height], [800, 600]);

  await assert.rejects(
    new ImageExtractor(ocr).extract(
      input(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    ),
    (e: unknown) => e instanceof ExtractionError && e.code === "CORRUPT_FILE",
  );
});

test("이미지 레이아웃 설명은 OCR과 같은 이미지로 별도 호출하고 INFERRED 보호 블록으로 저장한다", async () => {
  const ocr = new FakeOcr({ status: "COMPLETE", markdown: "# 신청서" });
  const describer = new FakeDescriber();
  const document = await new ImageExtractor(ocr, describer).extract(
    input(await png(3200, 1200)),
  );
  contentDocumentSchema.parse(document);
  assert.deepEqual(describer.images[0], ocr.images[0]);
  const region = document.blocks.find((b) => b.kind === "VISUAL_REGION")!;
  assert.deepEqual(
    [region.origin, region.isProtected, region.visual],
    [
      "INFERRED",
      true,
      {
        regionType: "TABLE",
        label: "고객 표",
        bbox: [100, 200, 900, 600],
        model: "fake:layout",
      },
    ],
  );
  assert.equal(region.text, "고객 표: 회원번호·주민번호 열");
  assert.equal(document.quality.status, "COMPLETE");
});

test("레이아웃 설명이 잘리거나 계약에 맞지 않거나 엔진이 없으면 OCR 결과는 살리고 PARTIAL로 표시한다", async () => {
  const image = await png(400, 200);
  const ocr = () => new FakeOcr({ status: "COMPLETE", markdown: "본문" });
  for (const describer of [
    new FakeDescriber(() => ({
      status: "TRUNCATED",
      reason: "레이아웃 응답이 잘렸습니다.",
      model: "m",
    })),
    new FakeDescriber(() => ({
      status: "INVALID",
      reason: "레이아웃 응답이 JSON이 아닙니다.",
      model: "m",
    })),
    null,
  ]) {
    const document = await new ImageExtractor(ocr(), describer).extract(
      input(image),
    );
    assert.equal(document.quality.status, "PARTIAL");
    assert.deepEqual(
      document.blocks.map((b) => b.origin),
      ["OCR"],
    );
    assert.ok(document.quality.warnings.some((w) => w.startsWith("1쪽: ")));
  }
});

test("시각 해석 블록은 INFERRED·보호 구간이 아니면 계약 위반이다", () => {
  const block = {
    id: "b0001",
    kind: "VISUAL_REGION",
    text: "x",
    location: {
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 0,
      page: 1,
    },
    origin: "OCR",
    isProtected: false,
    visual: { model: "m", bbox: [0, 0, 10, 10] },
  };
  assert.throws(() =>
    contentDocumentSchema.parse({
      schemaVersion: 1,
      itemId: "i",
      sourceSha256: "0".repeat(64),
      format: "IMAGE",
      extractor: { name: "n", version: "v" },
      quality: { status: "COMPLETE", warnings: [] },
      blocks: [block],
    }),
  );
});

test("Ollama 레이아웃 어댑터는 JSON 스키마를 요청하고 응답을 다시 검증한다", async () => {
  const original = globalThis.fetch;
  const requests: { format?: { required: string[] }; options: object }[] = [];
  const respond = (content: string, reason = "stop") => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          done: true,
          done_reason: reason,
          message: { content },
        }),
      );
    }) as typeof fetch;
  };
  const describer = new OllamaLayoutDescriber(
    "http://ollama:11434",
    "qwen3-vl:2b-instruct-q4_K_M",
    {
      timeoutMs: 1000,
      maxOutputTokens: 512,
    },
  );
  const image = new Uint8Array([1, 2, 3]);
  try {
    respond(JSON.stringify(sampleLayout));
    const ok = await describer.describe(image);
    assert.equal(ok.status, "COMPLETE");
    assert.deepEqual(requests[0].format!.required, ["summary", "regions"]);

    respond(
      JSON.stringify({
        ...sampleLayout,
        regions: [{ ...sampleLayout.regions[0], bbox: [900, 0, 100, 10] }],
      }),
    );
    assert.equal((await describer.describe(image)).status, "INVALID");
    respond(
      JSON.stringify({
        ...sampleLayout,
        regions: [{ ...sampleLayout.regions[0], bbox: [0, 0, 10, 1200] }],
      }),
    );
    assert.equal((await describer.describe(image)).status, "INVALID");
    respond("not json");
    assert.equal((await describer.describe(image)).status, "INVALID");
    respond('{"summary": "잘', "length");
    assert.equal((await describer.describe(image)).status, "TRUNCATED");
  } finally {
    globalThis.fetch = original;
  }
});

test("높은 이미지는 겹치는 가로 조각으로 OCR하고 레이아웃은 전체 이미지 한 장으로 설명한다", async () => {
  const tiles = await splitForOcr(await png(1000, 2000));
  const heights = await Promise.all(
    tiles.map(async (t) => (await sharp(t).metadata()).height),
  );
  assert.deepEqual(heights, [800, 800, 800]);
  const short = await png(1000, 700);
  assert.deepEqual(await splitForOcr(short), [short]);

  let call = 0;
  const parts = ["# 제목\n첫 줄\n경계 줄", "경계 줄\n둘째 줄", "셋째 줄"];
  const ocr: VisionOcr = {
    model: "fake:ocr",
    async recognize() {
      const i = call++;
      return i === 1
        ? { status: "TRUNCATED", markdown: "반복", model: "fake:ocr" }
        : { status: "COMPLETE", markdown: parts[i], model: "fake:ocr" };
    },
  };
  const describer = new FakeDescriber();
  const document = await new ImageExtractor(ocr, describer).extract(
    input(await png(1000, 2000)),
  );
  assert.equal(call, 3);
  assert.equal(describer.images.length, 1);
  assert.equal((await sharp(describer.images[0]).metadata()).height, 1600);
  // A truncated strip is dropped, the rest is kept and the page is PARTIAL.
  assert.equal(document.quality.status, "PARTIAL");
  assert.ok(document.quality.warnings.some((w) => w.includes("2/3조각")));
  assert.ok(
    document.blocks.some(
      (b) => b.origin === "OCR" && b.text.includes("셋째 줄"),
    ),
  );
});

test("조각 사이 겹친 줄은 한 번만 남긴다", () => {
  assert.equal(
    joinTranscripts(["가\n나\n다", "나\n다\n라", "마"]),
    "가\n나\n다\n\n라\n\n마",
  );
  assert.equal(joinTranscripts(["가", "가 "]), "가");
  assert.equal(joinTranscripts(["가", "나"]), "가\n\n나");
});

test("반복 루프에 빠진 출력은 스트리밍 중에 끊고 반복 이전 텍스트만 남긴다", async () => {
  const loop = "| 항목 | 값 |\n".repeat(60);
  assert.equal(
    findRepetition("# 제목\n본문\n" + loop),
    "# 제목\n본문\n".length + 11,
  );
  assert.equal(findRepetition("| --- | --- |\n" + "정상 본문 ".repeat(5)), -1);
  assert.equal(findRepetition("-".repeat(100)), -1);

  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => (cancelled = true));
    const encoder = new TextEncoder();
    const lines = ["# 제목\n", ...Array(500).fill("반복되는 줄입니다\n")];
    return new Response(
      new ReadableStream({
        pull(controller) {
          const next = lines.shift();
          if (next === undefined) return controller.close();
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ done: false, message: { content: next } }) +
                "\n",
            ),
          );
        },
      }),
    );
  }) as typeof fetch;
  try {
    const ocr = new OllamaVisionOcr("http://ollama:11434", "m", {
      timeoutMs: 1000,
      maxOutputTokens: 4096,
    });
    const result = await ocr.recognize(new Uint8Array([1]));
    assert.equal(result.status, "REPEATED");
    assert.equal(result.markdown, "# 제목\n반복되는 줄입니다");
    assert.ok(cancelled);
  } finally {
    globalThis.fetch = original;
  }
});
