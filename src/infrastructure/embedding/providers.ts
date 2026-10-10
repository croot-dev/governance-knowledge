import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../../domain/ports";
import type { Profile } from "../../domain/model";
import { NvidiaClient, positiveInt } from "../nvidia/client";
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
    model = "qwen3-embedding:0.6b",
    private apiKey = "",
    revision = "v1",
    // Qwen3-Embedding full output size: 0.6B = 1024, 4B = 2560, 8B = 4096.
    dimensions = 1024,
  ) {
    this.profile = makeProfile("qwen", model, dimensions, revision);
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
export class NvidiaEmbeddingProvider implements EmbeddingProvider {
  profile: Profile;
  constructor(
    private client = new NvidiaClient(),
    revision = "v1",
  ) {
    this.profile = makeProfile(
      "nvidia",
      process.env.EMBEDDING_NVIDIA_MODEL ?? "nvidia/llama-3.2-nv-embedqa-1b-v2",
      positiveInt("EMBEDDING_NVIDIA_DIMENSIONS", 2048),
      revision,
    );
  }
  private async request(texts: string[], inputType: "query" | "passage") {
    const result: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 16) {
      const input = texts.slice(offset, offset + 16);
      const response = await this.client.post<{
        data?: { index: number; embedding: number[] }[];
      }>("embeddings", {
        model: this.profile.model,
        input,
        input_type: inputType,
        dimensions: this.profile.dimensions,
        encoding_format: "float",
        truncate: "NONE",
      });
      if (
        !Array.isArray(response.data) ||
        response.data.length !== input.length
      )
        throw new Error("NVIDIA embedding 응답 개수가 일치하지 않습니다.");
      result.push(
        ...response.data
          .sort((a, b) => a.index - b.index)
          .map((entry, i) => {
            if (entry.index !== i || !Array.isArray(entry.embedding))
              throw new Error("NVIDIA embedding 응답 형식 오류");
            return normalizeVector(entry.embedding, this.profile.dimensions);
          }),
      );
    }
    return result;
  }
  async embedQuery(text: string) {
    return (await this.request([text], "query"))[0];
  }
  embedDocuments(texts: string[]) {
    return this.request(texts, "passage");
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const revision = process.env.EMBEDDING_REVISION ?? "v1";
  switch (process.env.EMBEDDING_PROVIDER ?? "mock") {
    case "nvidia":
      return new NvidiaEmbeddingProvider(undefined, revision);
    case "mock":
      return new MockEmbeddingProvider(revision);
    case "qwen":
      return new QwenEmbeddingProvider(
        process.env.EMBEDDING_QWEN_BASE_URL ?? "http://localhost:11434/v1",
        process.env.EMBEDDING_QWEN_MODEL,
        process.env.EMBEDDING_QWEN_API_KEY,
        revision,
        positiveInt("EMBEDDING_QWEN_DIMENSIONS", 1024),
      );
    default:
      throw new Error(
        "EMBEDDING_PROVIDER는 mock, qwen 또는 nvidia여야 합니다.",
      );
  }
}
