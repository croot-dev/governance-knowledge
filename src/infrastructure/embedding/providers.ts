import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../../domain/ports";
import type { Profile } from "../../domain/model";
export function makeProfile(
  provider: string,
  model: string,
  dimensions: number,
  revision = "v1",
): Profile {
  const id = createHash("sha256")
    .update(
      JSON.stringify({
        provider,
        model,
        dimensions,
        revision,
        textFormat: "v1",
        queryFormat: "v1",
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return { id, provider, model, dimensions, revision };
}
export function normalizeVector(vector: number[], dimensions: number) {
  if (vector.length !== dimensions || vector.some((v) => !Number.isFinite(v)))
    throw new Error(`임베딩은 유한한 ${dimensions}차원 벡터여야 합니다.`);
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm || !Number.isFinite(norm))
    throw new Error("임베딩 벡터의 norm이 유효하지 않습니다.");
  return vector.map((v) => v / norm);
}
export class MockEmbeddingProvider implements EmbeddingProvider {
  profile: Profile;
  constructor(revision = "v1") {
    this.profile = makeProfile("mock", "deterministic-sha256", 64, revision);
  }
  private vector(text: string) {
    const values = Array.from({ length: 2 }, (_, i) => [
      ...createHash("sha256").update(`${i}:${text}`).digest(),
    ])
      .flat()
      .map((v) => v / 127.5 - 1);
    return normalizeVector(values, this.profile.dimensions);
  }
  async embedQuery(text: string) {
    return this.vector(text);
  }
  async embedDocuments(texts: string[]) {
    return texts.map((t) => this.vector(t));
  }
}
export class QwenEmbeddingProvider implements EmbeddingProvider {
  profile: Profile;
  constructor(
    private baseUrl: string,
    model = "Qwen3-Embedding-4B-GGUF",
    private apiKey = "",
    revision = "v1",
  ) {
    this.profile = makeProfile("qwen", model, 2560, revision);
  }
  private async request(input: string[]) {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.profile.model,
          input,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok)
      throw new Error(`Qwen embedding service HTTP ${response.status}`);
    const data: { data?: { index: number; embedding: number[] }[] } =
      await response.json();
    if (!Array.isArray(data.data) || data.data.length !== input.length)
      throw new Error("Qwen 응답 개수가 일치하지 않습니다.");
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((entry, i) => {
        if (entry.index !== i || !Array.isArray(entry.embedding))
          throw new Error("Qwen 응답 형식이 올바르지 않습니다.");
        return normalizeVector(entry.embedding, this.profile.dimensions);
      });
  }
  async embedQuery(text: string) {
    const [vector] = await this.request([
      `Instruct: Given a governance query, retrieve relevant standard terms, expressions, and rules.\nQuery:${text}`,
    ]);
    return vector;
  }
  embedDocuments(texts: string[]) {
    return this.request(texts);
  }
}
export function createEmbeddingProvider(): EmbeddingProvider {
  const revision = process.env.EMBEDDING_REVISION ?? "v1";
  switch (process.env.EMBEDDING_PROVIDER ?? "mock") {
    case "mock":
      return new MockEmbeddingProvider(revision);
    case "qwen":
      return new QwenEmbeddingProvider(
        process.env.QWEN_BASE_URL ?? "http://localhost:8080/v1",
        process.env.QWEN_MODEL,
        process.env.QWEN_API_KEY,
        revision,
      );
    default:
      throw new Error("EMBEDDING_PROVIDER는 mock 또는 qwen이어야 합니다.");
  }
}
