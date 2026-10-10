import { GovernanceService } from "../application/governance";
import { IndexingService } from "../application/indexing";
import { SearchService } from "../application/search";
import { DocumentTransformService } from "../application/transform";
import { GovernanceCatalogService } from "../application/catalog";
import { StructuredLinkService } from "../application/enrichment/links";
import { IngestionService } from "../application/ingestion/service";
import { IngestionWorker } from "../application/ingestion/worker";
import { ZipArchiveReader } from "./archive/zip";
import { LocalArtifactStore } from "./artifacts/local";
import { CatalogRepository } from "./db/catalog";
import { IngestionRepository } from "./db/ingestion";
import { defaultExtractors } from "./extractors";
import { createVisionDescriber, createVisionOcr } from "./ocr/ollama";
import { getDatabase } from "./db/connection";
import { GovernanceRepository } from "./db/repository";
import { createEmbeddingProvider } from "./embedding/providers";
import { LanceVectorStore } from "./vector-store/lance";
export async function createRuntime() {
  const embedding = createEmbeddingProvider();
  const db = getDatabase();
  const repository = new GovernanceRepository(db, embedding.profile);
  await repository.initialize();
  const vectors = new LanceVectorStore(
    process.env.STORAGE_LANCEDB_URI ?? "./.data/lancedb",
    embedding.profile,
  );
  const catalog = new CatalogRepository(db);
  const ingestionStore = new IngestionRepository(db);
  const artifacts = new LocalArtifactStore(
    process.env.STORAGE_ARTIFACT_DIR ?? "./.data/artifacts",
  );
  const ingestion = new IngestionService(ingestionStore, artifacts);
  return {
    repository,
    embedding,
    vectors,
    governance: new GovernanceService(repository),
    indexing: new IndexingService(repository, embedding, vectors),
    search: new SearchService(repository, embedding, vectors),
    transform: new DocumentTransformService(repository),
    catalog: new GovernanceCatalogService(catalog),
    ingestion,
    links: new StructuredLinkService(ingestion, catalog),
    createIngestionWorker: (log?: (line: string) => void) =>
      new IngestionWorker(
        ingestionStore,
        artifacts,
        defaultExtractors(createVisionOcr(), createVisionDescriber()),
        new ZipArchiveReader(),
        undefined,
        log,
      ),
  };
}
let runtime: ReturnType<typeof createRuntime> | undefined;
export function getRuntime() {
  return (runtime ??= createRuntime().catch((error) => {
    runtime = undefined;
    throw error;
  }));
}
