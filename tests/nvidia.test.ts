import assert from "node:assert/strict";
import { test } from "node:test";
import { NvidiaClient } from "../src/infrastructure/nvidia/client";
import { NvidiaVisionOcr } from "../src/infrastructure/ocr/nvidia";
import { NvidiaEmbeddingProvider } from "../src/infrastructure/embedding/providers";

test("NVIDIA OCR preserves image MIME and rejects truncated or abnormal completions", async () => {
  const original = globalThis.fetch;
  let reason = "stop";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(
      body.messages[0].content[1].image_url.url,
      /^data:image\/jpeg;base64,/,
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-key",
    );
    return Response.json({
      choices: [{ finish_reason: reason, message: { content: "문서" } }],
    });
  };
  try {
    const ocr = new NvidiaVisionOcr(
      new NvidiaClient("test-key", "https://example.invalid/v1", 1000, 1),
    );
    const input = new Uint8Array([255, 216, 255]);
    assert.equal((await ocr.recognize(input)).status, "COMPLETE");
    reason = "length";
    assert.deepEqual((await ocr.recognize(input)).markdown, "");
    assert.equal((await ocr.recognize(input)).status, "TRUNCATED");
    reason = "content_filter";
    await assert.rejects(ocr.recognize(input), /정상 종료/);
  } finally {
    globalThis.fetch = original;
  }
});

test("NVIDIA embedding separates query/passage and rejects invalid vectors", async () => {
  const original = globalThis.fetch;
  const modes: string[] = [];
  let invalid = false;
  const provider = new NvidiaEmbeddingProvider(
    new NvidiaClient("test-key", "https://example.invalid/v1", 1000, 1),
  );
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    modes.push(body.input_type);
    assert.equal(body.truncate, "NONE");
    return Response.json({
      data: body.input.map((_: string, index: number) => ({
        index,
        embedding: Array(invalid ? 2 : provider.profile.dimensions).fill(1),
      })),
    });
  };
  try {
    await provider.embedQuery("직급");
    await provider.embedDocuments(["과장", "차장"]);
    assert.deepEqual(modes, ["query", "passage"]);
    assert.equal(provider.profile.provider, "nvidia");
    invalid = true;
    await assert.rejects(provider.embedQuery("직급"), /차원/);
  } finally {
    globalThis.fetch = original;
  }
});

test("NVIDIA missing credentials and non-retryable HTTP errors fail without leaking response bodies", async () => {
  await assert.rejects(
    new NvidiaClient("").post("embeddings", {}),
    /NVIDIA_API_KEY/,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("secret-body", { status: 401 });
  };
  try {
    await assert.rejects(
      new NvidiaClient("key", "https://example.invalid", 1000, 1).post(
        "embeddings",
        {},
      ),
      { message: "NVIDIA API HTTP 401" },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
