import { randomUUID } from "node:crypto";
import { AppError } from "../../domain/model";
import type { SourceFormat } from "../../domain/ingestion/content";
import type { BatchMode, ItemStatus } from "../../domain/ingestion/intake";
import type {
  ContentRecord,
  IngestionJob,
  IngestionStore,
  UploadBatch,
  UploadItem,
} from "../../domain/ingestion/ports";
import type { Database, Sql } from "./connection";

const ITEM_COLUMNS = `id, "batchId", "parentItemId", "relativePath", format, status, "objectKey",
  size::float8 AS size, sha256, error,
  (SELECT c.quality FROM content_documents c WHERE c."itemId"=upload_items.id
    ORDER BY c."createdAt" DESC, c.id LIMIT 1) AS "contentQuality"`;

export class IngestionRepository implements IngestionStore {
  constructor(public db: Database) {}

  async listBatches(limit: number) {
    const { rows } = await this.db.query<
      UploadBatch & {
        itemCount: number;
        failedCount: number;
        extractedCount: number;
        partialCount: number;
        cancelledCount: number;
        pendingJobs: number;
      }
    >(
      `SELECT b.*,
      (SELECT count(*)::int FROM upload_items i WHERE i."batchId"=b.id) AS "itemCount",
      (SELECT count(*)::int FROM upload_items i WHERE i."batchId"=b.id AND i.status IN ('FAILED','UNSUPPORTED')) AS "failedCount",
      (SELECT count(*)::int FROM upload_items i WHERE i."batchId"=b.id AND i.status='EXTRACTED') AS "extractedCount",
      (SELECT count(*)::int FROM upload_items i WHERE i."batchId"=b.id AND EXISTS
        (SELECT 1 FROM content_documents c WHERE c."itemId"=i.id AND c.quality='PARTIAL')) AS "partialCount",
      (SELECT count(*)::int FROM upload_items i WHERE i."batchId"=b.id AND i.status='CANCELLED') AS "cancelledCount",
      (SELECT count(*)::int FROM ingestion_jobs j JOIN upload_items i ON i.id=j."itemId"
        WHERE i."batchId"=b.id AND j.status IN ('PENDING','RUNNING')) AS "pendingJobs"
      FROM upload_batches b ORDER BY b."createdAt" DESC, b.id DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async createBatch(mode: BatchMode): Promise<UploadBatch> {
    const { rows } = await this.db.query<UploadBatch>(
      `INSERT INTO upload_batches(id, mode) VALUES($1,$2) RETURNING *`,
      [randomUUID(), mode],
    );
    return rows[0];
  }

  async getBatch(id: string, sql: Sql = this.db) {
    const { rows } = await sql.query<UploadBatch>(
      `SELECT * FROM upload_batches WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listItems(batchId: string) {
    const { rows } = await this.db.query<UploadItem>(
      `SELECT ${ITEM_COLUMNS} FROM upload_items WHERE "batchId"=$1 ORDER BY "relativePath"`,
      [batchId],
    );
    return rows;
  }

  async countItems(batchId: string) {
    const { rows } = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM upload_items WHERE "batchId"=$1`,
      [batchId],
    );
    return rows[0].count;
  }

  async getItem(id: string) {
    const { rows } = await this.db.query<UploadItem>(
      `SELECT ${ITEM_COLUMNS} FROM upload_items WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getItemByPath(batchId: string, relativePath: string) {
    const { rows } = await this.db.query<UploadItem>(
      `SELECT ${ITEM_COLUMNS} FROM upload_items WHERE "batchId"=$1 AND "relativePath"=$2`,
      [batchId, relativePath],
    );
    return rows[0] ?? null;
  }

  // The row exists before any bytes are written, so an interrupted upload is always findable.
  async insertItem(item: {
    id: string;
    batchId: string;
    parentItemId?: string | null;
    relativePath: string;
    status?: ItemStatus;
    objectKey?: string | null;
    error?: string | null;
  }) {
    try {
      await this.db.query(
        `INSERT INTO upload_items(id,"batchId","parentItemId","relativePath",status,"objectKey",error)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          item.id,
          item.batchId,
          item.parentItemId ?? null,
          item.relativePath,
          item.status ?? "UPLOADING",
          item.objectKey ?? null,
          item.error ?? null,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new AppError(
          409,
          "DUPLICATE_PATH",
          `같은 경로의 파일이 이미 있습니다: ${item.relativePath}`,
        );
      throw error;
    }
  }

  // READY items are queued in the same transaction, so a stored file is never left unqueued.
  async markStored(
    id: string,
    stored: {
      size: number;
      sha256: string;
      format: SourceFormat | null;
      error?: string;
    },
    next: "STORED" | "READY",
  ) {
    await this.db.transaction(async (sql) => {
      const status = stored.format ? next : "UNSUPPORTED";
      await sql.query(
        `UPDATE upload_items SET status=$2,size=$3,sha256=$4,format=$5,error=$6,"updatedAt"=now() WHERE id=$1`,
        [
          id,
          status,
          stored.size,
          stored.sha256,
          stored.format,
          stored.error ?? null,
        ],
      );
      if (status === "READY") await this.enqueue(sql, id, stored.format!);
    });
  }

  async markItem(id: string, status: ItemStatus, error: string | null = null) {
    await this.db.query(
      `UPDATE upload_items SET status=$2,error=$3,"updatedAt"=now() WHERE id=$1`,
      [id, status, error?.slice(0, 2000) ?? null],
    );
  }

  private async enqueue(sql: Sql, itemId: string, format: SourceFormat) {
    await sql.query(
      `INSERT INTO ingestion_jobs(id,"itemId",kind) VALUES($1,$2,$3) ON CONFLICT ("itemId",kind) DO NOTHING`,
      [randomUUID(), itemId, format === "ZIP" ? "EXPAND_ARCHIVE" : "EXTRACT"],
    );
  }

  async finalize(batchId: string) {
    return this.db.transaction(async (sql) => {
      const { rows } = await sql.query<UploadBatch>(
        `SELECT * FROM upload_batches WHERE id=$1 FOR UPDATE`,
        [batchId],
      );
      if (!rows[0])
        throw new AppError(404, "NOT_FOUND", "업로드 배치를 찾을 수 없습니다.");
      if (rows[0].status !== "OPEN")
        throw new AppError(409, "BATCH_FINALIZED", "이미 확정된 배치입니다.");
      await sql.query(
        `UPDATE upload_items SET status='FAILED',error='업로드가 완료되지 않았습니다.',"updatedAt"=now()
        WHERE "batchId"=$1 AND status='UPLOADING'`,
        [batchId],
      );
      const ready = await sql.query<{ id: string; format: SourceFormat }>(
        `UPDATE upload_items SET status='READY',"updatedAt"=now()
        WHERE "batchId"=$1 AND status='STORED' RETURNING id, format`,
        [batchId],
      );
      for (const item of ready.rows)
        await this.enqueue(sql, item.id, item.format);
      await sql.query(
        `UPDATE upload_batches SET status='FINALIZED',"finalizedAt"=now() WHERE id=$1`,
        [batchId],
      );
      await this.refreshEnumeration(batchId, sql);
    });
  }

  // Complete only when finalized and every archive has been fully listed.
  async refreshEnumeration(batchId: string, sql: Sql = this.db) {
    await sql.query(
      `UPDATE upload_batches b SET "enumerationComplete" = (b.status='FINALIZED' AND NOT EXISTS (
        SELECT 1 FROM upload_items i WHERE i."batchId"=b.id AND i.format='ZIP' AND i.status<>'EXTRACTED'))
      WHERE b.id=$1`,
      [batchId],
    );
  }

  async pendingJobCount(batchId: string) {
    const { rows } = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ingestion_jobs j JOIN upload_items i ON i.id=j."itemId"
      WHERE i."batchId"=$1 AND j.status IN ('PENDING','RUNNING')`,
      [batchId],
    );
    return rows[0].count;
  }

  // An expired lease is reclaimable, which recovers jobs from crashed workers.
  async claimJob(owner: string, leaseSeconds: number) {
    const { rows } = await this.db.query<IngestionJob>(
      `UPDATE ingestion_jobs SET status='RUNNING', attempts=attempts+1, "leaseOwner"=$1,
        "leaseUntil"=now() + make_interval(secs => $2), "updatedAt"=now()
      WHERE id = (SELECT id FROM ingestion_jobs
        WHERE (status='PENDING' AND "runAfter" <= now())
          OR (status='RUNNING' AND "leaseUntil" < now())
        ORDER BY "runAfter", id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, "itemId", kind, attempts`,
      [owner, leaseSeconds],
    );
    return rows[0] ?? null;
  }

  async renewLease(job: IngestionJob, owner: string, leaseSeconds: number) {
    const { rows } = await this.db.query(
      `UPDATE ingestion_jobs SET "leaseUntil"=now() + make_interval(secs => $3), "updatedAt"=now()
      WHERE id=$1 AND "leaseOwner"=$2 AND status='RUNNING' RETURNING id`,
      [job.id, owner, leaseSeconds],
    );
    return rows.length > 0;
  }

  // Fenced by lease owner: a worker whose lease was taken over cannot overwrite the new result.
  async finishJob(
    job: IngestionJob,
    owner: string,
    status: "DONE" | "FAILED" | "PENDING",
    error: string | null = null,
    retryAfterSeconds = 0,
  ) {
    const { rows } = await this.db.query(
      `UPDATE ingestion_jobs SET status=$3, error=$4, "leaseOwner"=NULL, "leaseUntil"=NULL,
        "runAfter"=now() + make_interval(secs => $5), "updatedAt"=now()
      WHERE id=$1 AND "leaseOwner"=$2 RETURNING id`,
      [job.id, owner, status, error?.slice(0, 2000) ?? null, retryAfterSeconds],
    );
    return rows.length > 0;
  }

  // Failed and stopped items get a fresh attempt budget; unsupported items and items without a job stay as they are.
  async retryFailed(batchId: string) {
    return this.db.transaction(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        `UPDATE ingestion_jobs j SET status='PENDING', attempts=0, error=NULL, "runAfter"=now(),
          "leaseOwner"=NULL, "leaseUntil"=NULL, "updatedAt"=now()
        FROM upload_items i
        WHERE i.id=j."itemId" AND i."batchId"=$1
          AND i.status IN ('FAILED','CANCELLED') AND j.status IN ('FAILED','CANCELLED')
        RETURNING i.id`,
        [batchId],
      );
      if (rows.length)
        await sql.query(
          `UPDATE upload_items SET status='READY', error=NULL, "updatedAt"=now() WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)],
        );
      await this.refreshEnumeration(batchId, sql);
      return rows.length;
    });
  }

  // Clearing the lease owner fences out a worker mid-run: its renewals and completion no longer match.
  async cancelBatch(batchId: string) {
    return this.db.transaction(async (sql) => {
      const { rows } = await sql.query<{ itemId: string }>(
        `UPDATE ingestion_jobs j SET status='CANCELLED', error='사용자가 처리를 중지했습니다.',
          "leaseOwner"=NULL, "leaseUntil"=NULL, "updatedAt"=now()
        FROM upload_items i
        WHERE i.id=j."itemId" AND i."batchId"=$1 AND j.status IN ('PENDING','RUNNING')
        RETURNING j."itemId"`,
        [batchId],
      );
      if (rows.length)
        await sql.query(
          `UPDATE upload_items SET status='CANCELLED', error='사용자가 처리를 중지했습니다.', "updatedAt"=now()
          WHERE id = ANY($1::uuid[]) AND status IN ('READY','STORED')`,
          [rows.map((r) => r.itemId)],
        );
      await this.refreshEnumeration(batchId, sql);
      return rows.length;
    });
  }

  async jobStatus(jobId: string) {
    const { rows } = await this.db.query<{ status: string }>(
      `SELECT status FROM ingestion_jobs WHERE id=$1`,
      [jobId],
    );
    return rows[0]?.status ?? null;
  }

  async insertContent(
    record: Omit<ContentRecord, "id"> & { sourceSha256: string },
  ) {
    await this.db.query(
      `INSERT INTO content_documents(id,"itemId","sourceSha256",extractor,"extractorVersion","objectKey",quality,"blockCount")
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("itemId",extractor,"extractorVersion") DO NOTHING`,
      [
        randomUUID(),
        record.itemId,
        record.sourceSha256,
        record.extractor,
        record.extractorVersion,
        record.objectKey,
        record.quality,
        record.blockCount,
      ],
    );
  }

  async latestContent(itemId: string) {
    const { rows } = await this.db.query<ContentRecord>(
      `SELECT id,"itemId",extractor,"extractorVersion","objectKey",quality,"blockCount"
      FROM content_documents WHERE "itemId"=$1 ORDER BY "createdAt" DESC, id LIMIT 1`,
      [itemId],
    );
    return rows[0] ?? null;
  }

  async staleUploads(olderThanMinutes: number) {
    const { rows } = await this.db.query<UploadItem>(
      `SELECT ${ITEM_COLUMNS} FROM upload_items
      WHERE status='UPLOADING' AND "updatedAt" < now() - make_interval(mins => $1)`,
      [olderThanMinutes],
    );
    return rows;
  }
}
