import { GovernanceService } from "../application/governance";
import { IndexingService } from "../application/indexing";
import { SearchService } from "../application/search";
import { DocumentTransformService } from "../application/transform";
import { getDatabase } from "./db/connection";
import { GovernanceRepository } from "./db/repository";
import { createEmbeddingProvider } from "./embedding/providers";
import { LanceVectorStore } from "./vector-store/lance";
export async function createRuntime() {
  const embedding = createEmbeddingProvider();
  const repository = new GovernanceRepository(getDatabase(), embedding.profile);
  await repository.initialize();
  const vectors = new LanceVectorStore(
    process.env.LANCEDB_URI ?? "./.data/lancedb",
    embedding.profile,
  );
  return {
    repository,
    embedding,
    vectors,
    governance: new GovernanceService(repository),
    indexing: new IndexingService(repository, embedding, vectors),
    search: new SearchService(repository, embedding, vectors),
    transform: new DocumentTransformService(repository),
  };
}
let runtime: ReturnType<typeof createRuntime> | undefined;
export function getRuntime() {
  return (runtime ??= createRuntime().catch((error) => {
    runtime = undefined;
    throw error;
  }));
}
