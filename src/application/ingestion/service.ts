import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../domain/model";
import {
  contentDocumentSchema,
  type ContentDocument,
} from "../../domain/ingestion/content";
import {
  LIMITS,
  batchModes,
  itemStatuses,
  detectFormat,
  normalizeRelativePath,
  type ItemStatus,
} from "../../domain/ingestion/intake";
import type {
  ArtifactStore,
  IngestionStore,
  UploadItem,
} from "../../domain/ingestion/ports";

const HEAD_BYTES = 16;
const createBatchSchema = z.object({ mode: z.enum(batchModes) }).strict();

// Captures the first bytes for format sniffing while the body streams to storage.
export function withHead(body: AsyncIterable<Uint8Array>) {
  const head = new Uint8Array(HEAD_BYTES);
  let filled = 0;
  async function* stream() {
    for await (const chunk of body) {
      if (filled < HEAD_BYTES) {
        const take = chunk.subarray(0, HEAD_BYTES - filled);
        head.set(take, filled);
        filled += take.byteLength;
      }
      yield chunk;
    }
  }
  return { stream: stream(), head: () => head.subarray(0, filled) };
}

export function originalKey(itemId: string) {
  return `originals/${itemId}`;
}

// Stores one original and records its hash and detected format; failures stay visible on the item.
export async function storeOriginal(
  store: IngestionStore,
  artifacts: ArtifactStore,
  item: { id: string; relativePath: string },
  body: AsyncIterable<Uint8Array>,
  next: "STORED" | "READY",
) {
  const key = originalKey(item.id);
  const { stream, head } = withHead(body);
  try {
    const stored = await artifacts.put(key, stream, {
      maxBytes: LIMITS.maxFileBytes,
    });
    const { format, reason } = detectFormat(item.relativePath, head());
    await store.markStored(item.id, { ...stored, format, error: reason }, next);
  } catch (error) {
    await store.markItem(item.id, "FAILED", (error as Error).message);
    await artifacts.delete(key);
    throw error;
  }
}

export interface BatchManifest {
  batch: Awaited<ReturnType<IngestionStore["getBatch"]>>;
  items: UploadItem[];
  counts: Record<ItemStatus, number>;
  pendingJobs: number;
  // True only when the listing is final and no item can still change.
  complete: boolean;
}

export class IngestionService {
  constructor(
    private store: IngestionStore,
    private artifacts: ArtifactStore,
  ) {}

  createBatch(input: unknown) {
    return this.store.createBatch(createBatchSchema.parse(input).mode);
  }

  listBatches() {
    return this.store.listBatches(50);
  }

  private async openBatch(batchId: string) {
    const batch = await this.store.getBatch(z.uuid().parse(batchId));
    if (!batch)
      throw new AppError(404, "NOT_FOUND", "업로드 배치를 찾을 수 없습니다.");
    return batch;
  }

  async addItem(
    batchId: string,
    rawPath: string,
    body: AsyncIterable<Uint8Array>,
  ) {
    const batch = await this.openBatch(batchId);
    if (batch.status !== "OPEN")
      throw new AppError(409, "BATCH_FINALIZED", "이미 확정된 배치입니다.");
    if ((await this.store.countItems(batch.id)) >= LIMITS.maxBatchItems)
      throw new AppError(
        413,
        "TOO_MANY_ITEMS",
        "배치 파일 수 한도를 넘었습니다.",
      );
    const relativePath = normalizeRelativePath(rawPath);
    const id = randomUUID();
    await this.store.insertItem({
      id,
      batchId: batch.id,
      relativePath,
      objectKey: originalKey(id),
    });
    await storeOriginal(
      this.store,
      this.artifacts,
      { id, relativePath },
      body,
      "STORED",
    );
    return (await this.store.getItem(id))!;
  }

  async finalize(batchId: string) {
    const batch = await this.openBatch(batchId);
    await this.store.finalize(batch.id);
    return this.manifest(batch.id);
  }

  // Stops queued and running jobs of a batch; running model calls are aborted by their workers.
  async cancel(batchId: string) {
    const batch = await this.openBatch(batchId);
    if (batch.status !== "FINALIZED")
      throw new AppError(
        409,
        "BATCH_OPEN",
        "확정된 배치만 중지할 수 있습니다.",
      );
    const cancelled = await this.store.cancelBatch(batch.id);
    return { cancelled, manifest: await this.manifest(batch.id) };
  }

  async retryFailed(batchId: string) {
    const batch = await this.openBatch(batchId);
    if (batch.status !== "FINALIZED")
      throw new AppError(
        409,
        "BATCH_OPEN",
        "확정된 배치만 재처리할 수 있습니다.",
      );
    const retried = await this.store.retryFailed(batch.id);
    return { retried, manifest: await this.manifest(batch.id) };
  }

  async manifest(batchId: string): Promise<BatchManifest> {
    const batch = await this.openBatch(batchId);
    const [items, pendingJobs] = await Promise.all([
      this.store.listItems(batch.id),
      this.store.pendingJobCount(batch.id),
    ]);
    const counts = Object.fromEntries(
      itemStatuses.map((s) => [s, items.filter((i) => i.status === s).length]),
    ) as Record<ItemStatus, number>;
    const unsettled = counts.UPLOADING + counts.STORED + counts.READY;
    return {
      batch,
      items,
      counts,
      pendingJobs,
      complete:
        batch.enumerationComplete && unsettled === 0 && pendingJobs === 0,
    };
  }

  // Serves a stored image original for previews; other formats are never streamed back raw.
  async originalImage(batchId: string, itemId: string) {
    const item = await this.store.getItem(z.uuid().parse(itemId));
    if (!item || item.batchId !== batchId)
      throw new AppError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    if (item.format !== "IMAGE" || !item.objectKey)
      throw new AppError(
        415,
        "NOT_AN_IMAGE",
        "이미지 원본만 미리보기로 제공합니다.",
      );
    const bytes = await this.artifacts.read(item.objectKey);
    const type =
      bytes[0] === 0x89
        ? "image/png"
        : bytes[0] === 0xff
          ? "image/jpeg"
          : "image/webp";
    return { bytes, type };
  }

  async content(batchId: string, itemId: string): Promise<ContentDocument> {
    const item = await this.store.getItem(z.uuid().parse(itemId));
    if (!item || item.batchId !== batchId)
      throw new AppError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    const record = await this.store.latestContent(item.id);
    if (!record)
      throw new AppError(
        409,
        "NOT_EXTRACTED",
        item.error ?? "아직 추출된 content가 없습니다.",
      );
    const json = new TextDecoder().decode(
      await this.artifacts.read(record.objectKey),
    );
    return contentDocumentSchema.parse(JSON.parse(json));
  }

  // Interrupted uploads leave a row and maybe a partial object; both are reclaimed here.
  async cleanupStaleUploads(olderThanMinutes = 60) {
    const stale = await this.store.staleUploads(olderThanMinutes);
    for (const item of stale) {
      if (item.objectKey) await this.artifacts.delete(item.objectKey);
      await this.store.markItem(
        item.id,
        "FAILED",
        "업로드가 완료되지 않아 정리했습니다.",
      );
    }
    return stale.length;
  }
}
