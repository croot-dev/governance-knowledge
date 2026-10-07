import type {
  EmbeddingProvider,
  IndexRepository,
  VectorStore,
} from "../domain/ports";
export class IndexingService {
  constructor(
    private repository: IndexRepository,
    private embedding: EmbeddingProvider,
    private vectors: VectorStore,
  ) {}
  async processOne(): Promise<boolean> {
    const job = await this.repository.claim();
    if (!job) return false;
    try {
      const source = await this.repository.getSnapshot(
        job.entityType,
        job.entityId,
      );
      const key = `${job.entityType}:${job.entityId}`;
      if (!source?.searchable) await this.vectors.delete(key);
      else {
        const [vector] = await this.embedding.embedDocuments([source.text]);
        // A mutation during embedding invalidates this attempt before the external write.
        const current = await this.repository.getSnapshot(
          job.entityType,
          job.entityId,
        );
        if (current?.stamp !== source.stamp || !current.searchable) return true;
        await this.vectors.upsert({
          key,
          entityType: job.entityType,
          entityId: job.entityId,
          termId: source.entity.termId ?? "",
          domain: source.entity.domain,
          version: source.entity.version,
          stamp: source.stamp,
          vector,
        });
      }
      // Conditional completion cannot mark a newer queued revision READY.
      await this.repository.finish(job);
    } catch (error) {
      await this.repository.finish(
        job,
        error instanceof Error ? error.message : "인덱싱 실패",
      );
    }
    return true;
  }
}
