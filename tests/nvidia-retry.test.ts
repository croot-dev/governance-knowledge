import assert from "node:assert/strict";
import { test } from "node:test";
import { NvidiaClient } from "../src/infrastructure/nvidia/client";

test("NVIDIA retries throttling but does not retry past a long provider cooldown", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1
      ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
      : Response.json({ ok: true });
  try {
    const client = new NvidiaClient("key", "https://example.invalid", 5000, 1);
    assert.deepEqual(await client.post("embeddings", {}), { ok: true });
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "120" },
      });
    };
    await assert.rejects(client.post("embeddings", {}), /60초/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
