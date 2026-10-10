import type { LayoutResult } from "./layout";
import type { ContentDocument, SourceFormat } from "./content";
import type { BatchMode, ItemStatus } from "./intake";

export interface StoredObject {
  size: number;
  sha256: string;
}
// Keys are always chosen by the server. Implementations: local volume now, S3/SeaweedFS later.
export interface ArtifactStore {
  put(
    key: string,
    body: AsyncIterable<Uint8Array>,
    options: { maxBytes: number },
  ): Promise<StoredObject>;
  read(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface ExtractionInput {
  itemId: string;
  relativePath: string;
  sha256: string;
  bytes: Uint8Array;
  // Long extractions (OCR per page) call this so the job lease does not expire mid-run.
  heartbeat?: () => Promise<void>;
  // Aborted when the user stops the batch; model calls in flight are cancelled too.
  signal?: AbortSignal;
}

// "COMPLETE" only when the engine reports a normal stop; truncated output is never accepted as text.
export interface OcrResult {
  // REPEATED: the model fell into a loop; markdown holds only the text before it.
  status: "COMPLETE" | "TRUNCATED" | "REPEATED" | "EMPTY";
  markdown: string;
  model: string;
}
export interface VisionDescriber {
  model: string;
  describe(image: Uint8Array, signal?: AbortSignal): Promise<LayoutResult>;
}
export interface VisionOcr {
  model: string;
  recognize(image: Uint8Array, signal?: AbortSignal): Promise<OcrResult>;
}
export interface ContentExtractor {
  name: string;
  version: string;
  formats: readonly SourceFormat[];
  extract(input: ExtractionInput): Promise<ContentDocument>;
}

export interface ArchiveEntry {
  path: string;
  size: number;
  open(): Promise<AsyncIterable<Uint8Array>>;
}
// Problems with one entry are reported per entry; a broken listing fails the whole archive.
export interface ArchiveEntryIssue {
  path: string;
  status: "UNSUPPORTED" | "FAILED";
  reason: string;
}
export interface ArchiveReader {
  list(bytes: Uint8Array): Promise<{
    entries: ArchiveEntry[];
    issues: ArchiveEntryIssue[];
    close(): void;
  }>;
}

export interface UploadBatch {
  id: string;
  mode: BatchMode;
  status: "OPEN" | "FINALIZED";
  enumerationComplete: boolean;
  createdAt: string;
  finalizedAt: string | null;
}
export interface UploadItem {
  id: string;
  batchId: string;
  parentItemId: string | null;
  relativePath: string;
  format: SourceFormat | null;
  status: ItemStatus;
  objectKey: string | null;
  size: number | null;
  sha256: string | null;
  error: string | null;
  // PARTIAL means some pages were skipped or truncated; see the content warnings.
  contentQuality: "COMPLETE" | "PARTIAL" | null;
}
export interface IngestionJob {
  id: string;
  itemId: string;
  kind: "EXPAND_ARCHIVE" | "EXTRACT";
  attempts: number;
}
export interface ContentRecord {
  id: string;
  itemId: string;
  extractor: string;
  extractorVersion: string;
  objectKey: string;
  quality: "COMPLETE" | "PARTIAL";
  blockCount: number;
}

export interface IngestionStore {
  listBatches(limit: number): Promise<
    (UploadBatch & {
      itemCount: number;
      failedCount: number;
      extractedCount: number;
      partialCount: number;
      pendingJobs: number;
    })[]
  >;
  createBatch(mode: BatchMode): Promise<UploadBatch>;
  getBatch(id: string): Promise<UploadBatch | null>;
  listItems(batchId: string): Promise<UploadItem[]>;
  countItems(batchId: string): Promise<number>;
  getItem(id: string): Promise<UploadItem | null>;
  getItemByPath(
    batchId: string,
    relativePath: string,
  ): Promise<UploadItem | null>;
  insertItem(item: {
    id: string;
    batchId: string;
    parentItemId?: string | null;
    relativePath: string;
    status?: ItemStatus;
    objectKey?: string | null;
    error?: string | null;
  }): Promise<void>;
  markStored(
    id: string,
    stored: {
      size: number;
      sha256: string;
      format: SourceFormat | null;
      error?: string;
    },
    next: "STORED" | "READY",
  ): Promise<void>;
  markItem(
    id: string,
    status: ItemStatus,
    error?: string | null,
  ): Promise<void>;
  finalize(batchId: string): Promise<void>;
  refreshEnumeration(batchId: string): Promise<void>;
  pendingJobCount(batchId: string): Promise<number>;
  claimJob(owner: string, leaseSeconds: number): Promise<IngestionJob | null>;
  renewLease(
    job: IngestionJob,
    owner: string,
    leaseSeconds: number,
  ): Promise<boolean>;
  finishJob(
    job: IngestionJob,
    owner: string,
    status: "DONE" | "FAILED" | "PENDING",
    error?: string | null,
    retryAfterSeconds?: number,
  ): Promise<boolean>;
  retryFailed(batchId: string): Promise<number>;
  cancelBatch(batchId: string): Promise<number>;
  jobStatus(jobId: string): Promise<string | null>;
  insertContent(
    record: Omit<ContentRecord, "id"> & { sourceSha256: string },
  ): Promise<void>;
  latestContent(itemId: string): Promise<ContentRecord | null>;
  staleUploads(olderThanMinutes: number): Promise<UploadItem[]>;
}
