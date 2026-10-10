import { createHash, randomUUID } from "node:crypto";
import {
  ExtractionError,
  contentDocumentSchema,
} from "../../domain/ingestion/content";
import { LIMITS } from "../../domain/ingestion/intake";
import type {
  ArchiveReader,
  ArtifactStore,
  ContentExtractor,
  IngestionJob,
  IngestionStore,
  UploadItem,
} from "../../domain/ingestion/ports";
import { originalKey, storeOriginal } from "./service";

export const MAX_ATTEMPTS = 3;
// Transient failures (model server down, timeouts) wait 60s, then 180s, before the next attempt.
export const RETRY_BASE_SECONDS = 60;
// Kept short and renewed while a job runs, so a crashed worker's job is reclaimed within minutes.
export const LEASE_SECONDS = 180;
// Renewal doubles as the stop check: a stopped job no longer renews, which aborts the model call.
export const LEASE_RENEW_MS = 10_000;

// Errors that retrying cannot fix: the item is marked FAILED immediately.
export class PermanentIngestionError extends Error {}
// The job was stopped by the user or taken over by another worker; its result must not be applied.
export class JobReleasedError extends Error {}

export class IngestionWorker {
  constructor(
    private store: IngestionStore,
    private artifacts: ArtifactStore,
    private extractors: ContentExtractor[],
    private archives: ArchiveReader,
    private owner: string = `worker-${randomUUID()}`,
    private log: (line: string) => void = () => {},
    private renewMs = LEASE_RENEW_MS,
  ) {}

  async processOne(): Promise<boolean> {
    const job = await this.store.claimJob(this.owner, LEASE_SECONDS);
    if (!job) return false;
    const item = await this.store.getItem(job.itemId);
    if (!item) {
      await this.store.finishJob(job, this.owner, "FAILED", "파일 항목 없음");
      return true;
    }
    const label = `${job.kind} ${item.relativePath} (시도 ${job.attempts})`;
    const started = Date.now();
    const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
    const controller = new AbortController();
    const keepLease = async () => {
      if (!(await this.store.renewLease(job, this.owner, LEASE_SECONDS)))
        controller.abort(
          new JobReleasedError(
            "작업이 중지되었거나 다른 worker로 넘어갔습니다.",
          ),
        );
    };
    this.log(`시작 ${label}`);
    const renewal = setInterval(() => {
      keepLease().catch((error) =>
        this.log(`lease 연장 실패 ${label}: ${error}`),
      );
    }, this.renewMs);
    try {
      if (job.kind === "EXTRACT")
        await this.extract(item, controller.signal, keepLease);
      else await this.expand(item, controller.signal);
      controller.signal.throwIfAborted();
      // Only a job this worker still owns may publish its result.
      if (!(await this.store.finishJob(job, this.owner, "DONE")))
        throw new JobReleasedError(
          "작업이 중지되어 결과를 반영하지 않았습니다.",
        );
      await this.store.markItem(item.id, "EXTRACTED");
      if (job.kind === "EXPAND_ARCHIVE")
        await this.store.refreshEnumeration(item.batchId);
      this.log(`완료 ${label} ${elapsed()}`);
    } catch (error) {
      if (controller.signal.aborted || error instanceof JobReleasedError) {
        this.log(`중지 ${label} ${elapsed()}`);
        // Archive children queued while the stop was in flight are stopped as well.
        if (
          job.kind === "EXPAND_ARCHIVE" &&
          (await this.store.jobStatus(job.id)) === "CANCELLED"
        )
          await this.store.cancelBatch(item.batchId);
      } else {
        this.log(`실패 ${label} ${elapsed()}: ${describe(error as Error)}`);
        await this.fail(job, item, error as Error);
      }
    } finally {
      clearInterval(renewal);
    }
    return true;
  }

  private async fail(job: IngestionJob, item: UploadItem, error: Error) {
    const permanent =
      error instanceof ExtractionError ||
      error instanceof PermanentIngestionError ||
      job.attempts >= MAX_ATTEMPTS;
    const message = describe(error);
    if (!permanent) {
      await this.store.finishJob(
        job,
        this.owner,
        "PENDING",
        message,
        RETRY_BASE_SECONDS * 3 ** (job.attempts - 1),
      );
      return;
    }
    if (await this.store.finishJob(job, this.owner, "FAILED", message)) {
      await this.store.markItem(item.id, "FAILED", message);
      await this.store.refreshEnumeration(item.batchId);
    }
  }

  // The original is immutable: any hash drift is treated as corruption, never re-hashed.
  private async original(item: UploadItem) {
    if (!item.objectKey || !item.sha256)
      throw new PermanentIngestionError("저장된 원본이 없습니다.");
    const bytes = await this.artifacts.read(item.objectKey);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== item.sha256)
      throw new PermanentIngestionError("원본 hash가 일치하지 않습니다.");
    return bytes;
  }

  private async extract(
    item: UploadItem,
    signal: AbortSignal,
    keepLease: () => Promise<void>,
  ) {
    const extractor = this.extractors.find((e) =>
      (e.formats as readonly string[]).includes(item.format ?? ""),
    );
    if (!extractor)
      throw new ExtractionError(
        "UNSUPPORTED_FORMAT",
        `추출기가 없는 형식입니다: ${item.format}`,
      );
    const bytes = await this.original(item);
    const document = contentDocumentSchema.parse(
      await extractor.extract({
        itemId: item.id,
        relativePath: item.relativePath,
        sha256: item.sha256!,
        bytes,
        signal,
        heartbeat: async () => {
          await keepLease();
          signal.throwIfAborted();
        },
      }),
    );
    signal.throwIfAborted();
    const key = `content/${item.id}/${extractor.name}@${extractor.version}.json`;
    const json = new TextEncoder().encode(JSON.stringify(document));
    await this.artifacts.put(
      key,
      (async function* () {
        yield json;
      })(),
      {
        maxBytes: LIMITS.maxFileBytes * 4,
      },
    );
    await this.store.insertContent({
      itemId: item.id,
      sourceSha256: item.sha256!,
      extractor: extractor.name,
      extractorVersion: extractor.version,
      objectKey: key,
      quality: document.quality.status,
      blockCount: document.blocks.length,
    });
  }

  // Re-running after a crash skips children that were already stored.
  private async expand(item: UploadItem, signal: AbortSignal) {
    const bytes = await this.original(item);
    let listing;
    try {
      listing = await this.archives.list(bytes);
    } catch (error) {
      throw new PermanentIngestionError((error as Error).message);
    }
    try {
      for (const issue of listing.issues) {
        const path = `${item.relativePath}/${issue.path}`;
        if (await this.store.getItemByPath(item.batchId, path)) continue;
        await this.store.insertItem({
          id: randomUUID(),
          batchId: item.batchId,
          parentItemId: item.id,
          relativePath: path,
          status: issue.status,
          error: issue.reason,
        });
      }
      for (const entry of listing.entries) {
        signal.throwIfAborted();
        const path = `${item.relativePath}/${entry.path}`;
        const existing = await this.store.getItemByPath(item.batchId, path);
        if (existing && existing.status !== "UPLOADING") continue;
        const id = existing?.id ?? randomUUID();
        if (!existing)
          await this.store.insertItem({
            id,
            batchId: item.batchId,
            parentItemId: item.id,
            relativePath: path,
            objectKey: originalKey(id),
          });
        try {
          await storeOriginal(
            this.store,
            this.artifacts,
            { id, relativePath: path },
            await entry.open(),
            "READY",
          );
        } catch (error) {
          // One broken entry is recorded on its own row; the other entries still proceed.
          await this.store.markItem(id, "FAILED", (error as Error).message);
        }
      }
    } finally {
      listing.close();
    }
  }
}

// fetch() reports only "fetch failed"; the cause (e.g. ECONNREFUSED) says which dependency is down.
function describe(error: Error) {
  if (error instanceof ExtractionError)
    return `${error.code}: ${error.message}`;
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message} (${detail})` : error.message;
}
