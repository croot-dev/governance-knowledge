import { AppError, type SearchResult } from "../domain/model";
import type {
  EmbeddingProvider,
  IndexRepository,
  VectorStore,
} from "../domain/ports";
import { searchSchema } from "../domain/validation";
export class SearchService {
  constructor(
    private repository: Pick<IndexRepository, "getSnapshot">,
    private embedding: EmbeddingProvider,
    private vectors: VectorStore,
  ) {}
  async search(input: unknown) {
    const options = searchSchema.parse(input);
    try {
      const vector = await this.embedding.embedQuery(options.query);
      const candidates = await this.vectors.search(vector, {
        types: options.types,
        domain: options.domain,
        limit: Math.min(options.topK * 3, 300),
      });
      const results: SearchResult[] = [];
      for (const candidate of candidates) {
        const source = await this.repository.getSnapshot(
          candidate.entityType,
          candidate.entityId,
        );
        if (
          !source?.searchable ||
          source.stamp !== candidate.stamp ||
          !options.types.includes(source.entityType) ||
          (options.domain && source.entity.domain !== options.domain)
        )
          continue;
        const e = source.entity;
        results.push({
          type: source.entityType,
          id: e.id,
          text: e.text ?? e.name!,
          termId: e.termId,
          termName: e.termName,
          domain: e.domain,
          score: candidate.score,
        });
        if (results.length === options.topK) break;
      }
      return {
        results,
        provider: this.embedding.profile.provider,
        scoreMetric: "cosine_similarity",
      };
    } catch (error) {
      console.error("Search unavailable:", error);
      throw new AppError(
        503,
        "SEARCH_UNAVAILABLE",
        "검색 서비스에 연결할 수 없습니다. provider와 인덱스 상태를 확인해주세요.",
      );
    }
  }
}
