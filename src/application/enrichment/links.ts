import { linkStructuredValues } from "../../domain/enrichment/linking";
import type { GovernanceCatalog } from "../../domain/ports";
import type { IngestionService } from "../ingestion/service";

export class StructuredLinkService {
  constructor(
    private ingestion: IngestionService,
    private catalog: Pick<GovernanceCatalog, "activeVocabulary">,
  ) {}

  async links(batchId: string, itemId: string) {
    const [document, vocabulary] = await Promise.all([
      this.ingestion.content(batchId, itemId),
      this.catalog.activeVocabulary(),
    ]);
    return {
      itemId: document.itemId,
      sourceSha256: document.sourceSha256,
      ...linkStructuredValues(document, vocabulary),
    };
  }
}
