import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import { createTestDatabase } from "./helpers/db";
import { IngestionRepository } from "../src/infrastructure/db/ingestion";
import {
  LocalArtifactStore,
  bytesOf,
} from "../src/infrastructure/artifacts/local";
import { defaultExtractors } from "../src/infrastructure/extractors";
import { ZipArchiveReader } from "../src/infrastructure/archive/zip";
import { IngestionService } from "../src/application/ingestion/service";
import { IngestionWorker } from "../src/application/ingestion/worker";
import { AppError } from "../src/domain/model";
import type { ContentExtractor } from "../src/domain/ingestion/ports";

const encode = (text: string) => new TextEncoder().encode(text);

async function setup() {
  const { pg, db } = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), "governance-artifacts-"));
  const store = new IngestionRepository(db);
  const artifacts = new LocalArtifactStore(directory);
  const service = new IngestionService(store, artifacts);
  const worker = (owner?: string) =>
    new IngestionWorker(
      store,
      artifacts,
      defaultExtractors(null),
      new ZipArchiveReader(),
      owner,
    );
  const drain = async () => {
    const w = worker();
    for (let i = 0; i < 200; i++) if (!(await w.processOne())) return;
    throw new Error("worker did not converge");
  };
  const upload = (batchId: string, path: string, data: Uint8Array | string) =>
    service.addItem(
      batchId,
      path,
      bytesOf(typeof data === "string" ? encode(data) : data),
    );
  return {
    db,
    store,
    artifacts,
    service,
    worker,
    drain,
    upload,
    directory,
    async close() {
      await pg.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function zip(build: (z: yazl.ZipFile) => void): Promise<Uint8Array> {
  const file = new yazl.ZipFile();
  build(file);
  file.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    file.outputStream.on("data", (c: Buffer) => chunks.push(c));
    file.outputStream.on("end", () =>
      resolve(new Uint8Array(Buffer.concat(chunks))),
    );
    file.outputStream.on("error", reject);
  });
}

const byPath = <T extends { relativePath: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.relativePath, i]));

test("폴더 배치는 경로를 보존하고 형식별 추출·미지원·실패를 각각 기록한다", async () => {
  const app = await setup();
  try {
    const batch = await app.service.createBatch({ mode: "FOLDER" });
    await app.upload(batch.id, "a/readme.md", "# A\n\n- 회원번호: CUST-1\n");
    await app.upload(batch.id, "b/readme.md", "# B\n");
    await app.upload(batch.id, "logs/app.log", "2026-10-10 09:00:00 INFO ok\n");
    await app.upload(batch.id, "notes.txt", "hello\n");
    await app.upload(batch.id, "scan.pdf", "%PDF-1.7\n...");
    await app.upload(batch.id, "fake.pdf", "not a pdf");
    await app.upload(batch.id, "report.docx", "x");
    await assert.rejects(
      app.upload(batch.id, "a/readme.md", "dup"),
      (e: unknown) => e instanceof AppError && e.code === "DUPLICATE_PATH",
    );
    await assert.rejects(
      app.upload(batch.id, "../escape.md", "x"),
      (e: unknown) => e instanceof AppError && e.code === "INVALID_PATH",
    );

    let manifest = await app.service.finalize(batch.id);
    assert.equal(manifest.complete, false);
    await app.drain();
    manifest = await app.service.manifest(batch.id);

    const items = byPath(manifest.items);
    assert.equal(items["a/readme.md"].status, "EXTRACTED");
    assert.equal(items["b/readme.md"].status, "EXTRACTED");
    assert.equal(items["logs/app.log"].status, "EXTRACTED");
    assert.equal(items["notes.txt"].status, "EXTRACTED");
    assert.equal(items["scan.pdf"].status, "FAILED");
    assert.match(items["scan.pdf"].error!, /CORRUPT_FILE/);
    assert.equal(items["fake.pdf"].status, "UNSUPPORTED");
    assert.equal(items["report.docx"].status, "UNSUPPORTED");
    assert.deepEqual(manifest.counts, {
      UPLOADING: 0,
      STORED: 0,
      READY: 0,
      EXTRACTED: 4,
      UNSUPPORTED: 2,
      FAILED: 1,
      CANCELLED: 0,
    });
    assert.equal(manifest.batch!.enumerationComplete, true);
    assert.equal(manifest.complete, true);

    const content = await app.service.content(
      batch.id,
      items["a/readme.md"].id,
    );
    assert.equal(content.blocks[1].text, "회원번호: CUST-1");
    const original = await app.artifacts.read(items["a/readme.md"].objectKey!);
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      items["a/readme.md"].sha256,
    );
    await assert.rejects(
      app.upload(batch.id, "late.md", "x"),
      (e: unknown) => e instanceof AppError && e.code === "BATCH_FINALIZED",
    );
  } finally {
    await app.close();
  }
});

test("ZIP은 안전한 항목만 풀고 심볼릭 링크·중첩 압축·암호화 항목은 사유와 함께 남긴다", async () => {
  const app = await setup();
  try {
    const archive = await zip((z) => {
      z.addBuffer(Buffer.from("# 문서\n"), "docs/a.md");
      z.addBuffer(Buffer.from("2026-10-10 INFO x\n"), "logs/app.log");
      z.addBuffer(Buffer.from("PK"), "inner/nested.zip");
      z.addBuffer(Buffer.from("/etc/passwd"), "link.md", { mode: 0o120777 });
      z.addBuffer(Buffer.from("x"), "image.bmp");
    });
    const batch = await app.service.createBatch({ mode: "ZIP" });
    await app.upload(batch.id, "bundle.zip", archive);
    await app.service.finalize(batch.id);
    assert.equal(
      (await app.service.manifest(batch.id)).batch!.enumerationComplete,
      false,
    );
    await app.drain();
    const manifest = await app.service.manifest(batch.id);
    const items = byPath(manifest.items);

    assert.equal(items["bundle.zip"].status, "EXTRACTED");
    assert.equal(items["bundle.zip/docs/a.md"].status, "EXTRACTED");
    assert.equal(
      items["bundle.zip/docs/a.md"].parentItemId,
      items["bundle.zip"].id,
    );
    assert.equal(items["bundle.zip/logs/app.log"].status, "EXTRACTED");
    assert.equal(items["bundle.zip/inner/nested.zip"].status, "UNSUPPORTED");
    assert.equal(items["bundle.zip/link.md"].status, "FAILED");
    assert.match(items["bundle.zip/link.md"].error!, /심볼릭 링크/);
    assert.equal(items["bundle.zip/image.bmp"].status, "UNSUPPORTED");
    assert.equal(manifest.batch!.enumerationComplete, true);
    assert.equal(manifest.complete, true);
  } finally {
    await app.close();
  }
});

test("압축 비율이 비정상인 ZIP은 거부하고 목록 미확정으로 남겨 완료로 보이지 않는다", async () => {
  const app = await setup();
  try {
    const bomb = await zip((z) =>
      z.addBuffer(Buffer.alloc(2 * 1024 * 1024), "zeros.txt"),
    );
    const batch = await app.service.createBatch({ mode: "ZIP" });
    await app.upload(batch.id, "bomb.zip", bomb);
    await app.service.finalize(batch.id);
    await app.drain();
    const manifest = await app.service.manifest(batch.id);
    assert.equal(byPath(manifest.items)["bomb.zip"].status, "FAILED");
    assert.match(byPath(manifest.items)["bomb.zip"].error!, /압축 비율/);
    assert.equal(manifest.items.length, 1);
    assert.equal(manifest.batch!.enumerationComplete, false);
    assert.equal(manifest.complete, false);
  } finally {
    await app.close();
  }
});

test("중단된 worker의 작업은 lease 만료 후 회수되고 이전 소유자는 결과를 덮어쓸 수 없다", async () => {
  const app = await setup();
  try {
    const batch = await app.service.createBatch({ mode: "FILES" });
    await app.upload(batch.id, "doc.md", "# x\n");
    await app.service.finalize(batch.id);
    const crashed = await app.store.claimJob("crashed-worker", 300);
    assert.ok(crashed);
    assert.equal(await app.worker("other").processOne(), false);

    await app.db.query(
      `UPDATE ingestion_jobs SET "leaseUntil"=now() - interval '1 second'`,
    );
    assert.equal(await app.worker("rescuer").processOne(), true);
    assert.equal(
      await app.store.finishJob(crashed, "crashed-worker", "FAILED", "late"),
      false,
    );

    const manifest = await app.service.manifest(batch.id);
    assert.equal(manifest.items[0].status, "EXTRACTED");
    assert.equal(manifest.complete, true);
  } finally {
    await app.close();
  }
});

test("저장된 원본이 바뀌면 다시 계산하지 않고 손상으로 실패 처리한다", async () => {
  const app = await setup();
  try {
    const batch = await app.service.createBatch({ mode: "FILES" });
    const item = await app.upload(batch.id, "doc.md", "# original\n");
    await writeFile(join(app.directory, item.objectKey!), "# tampered\n");
    await app.service.finalize(batch.id);
    await app.drain();
    const [after] = (await app.service.manifest(batch.id)).items;
    assert.equal(after.status, "FAILED");
    assert.match(after.error!, /hash/);
    await assert.rejects(app.service.content(batch.id, item.id), AppError);
  } finally {
    await app.close();
  }
});

test("확정 시 업로드가 끝나지 않은 항목은 실패로 기록하고 정리 작업이 남은 객체를 지운다", async () => {
  const app = await setup();
  try {
    const batch = await app.service.createBatch({ mode: "FILES" });
    await app.store.insertItem({
      id: "00000000-0000-4000-8000-0000000000aa",
      batchId: batch.id,
      relativePath: "stuck.md",
      objectKey: "originals/00000000-0000-4000-8000-0000000000aa",
    });
    await app.artifacts.put(
      "originals/00000000-0000-4000-8000-0000000000aa",
      bytesOf(encode("partial")),
      { maxBytes: 100 },
    );
    await app.db.query(
      `UPDATE upload_items SET "updatedAt"=now() - interval '2 hours'`,
    );
    assert.equal(await app.service.cleanupStaleUploads(60), 1);
    assert.equal(
      await app.artifacts.exists(
        "originals/00000000-0000-4000-8000-0000000000aa",
      ),
      false,
    );

    const other = await app.service.createBatch({ mode: "FILES" });
    await app.store.insertItem({
      id: "00000000-0000-4000-8000-0000000000bb",
      batchId: other.id,
      relativePath: "never-finished.md",
    });
    const manifest = await app.service.finalize(other.id);
    assert.equal(manifest.items[0].status, "FAILED");
    assert.equal(manifest.complete, true);
  } finally {
    await app.close();
  }
});

test("파일 크기 한도를 넘으면 저장하지 않고 임시 파일도 남기지 않는다", async () => {
  const app = await setup();
  try {
    await assert.rejects(
      app.artifacts.put("originals/too-big", bytesOf(new Uint8Array(11)), {
        maxBytes: 10,
      }),
      (e: unknown) => e instanceof AppError && e.code === "FILE_TOO_LARGE",
    );
    assert.equal(await app.artifacts.exists("originals/too-big"), false);
    assert.deepEqual(await readdir(join(app.directory, "originals")), []);
  } finally {
    await app.close();
  }
});

test("모델 서버 연결 실패는 간격을 두고 재시도하고, 실패 확정 후 수동 재처리로 복구된다", async () => {
  const app = await setup();
  try {
    const down: ContentExtractor = {
      name: "markdown-down",
      version: "1",
      formats: ["MARKDOWN"],
      async extract() {
        throw new TypeError("fetch failed", {
          cause: { code: "ECONNREFUSED" },
        });
      },
    };
    const broken = new IngestionWorker(
      app.store,
      app.artifacts,
      [down],
      new ZipArchiveReader(),
      "broken",
    );
    const batch = await app.service.createBatch({ mode: "FILES" });
    await app.upload(batch.id, "doc.md", "# x\n");
    await app.service.finalize(batch.id);

    assert.equal(await broken.processOne(), true);
    // The retry waits; an immediate second attempt is not available.
    assert.equal(await broken.processOne(), false);
    const [job] = (
      await app.db.query<{ status: string; error: string; wait: number }>(
        `SELECT status, error, extract(epoch FROM "runAfter" - now())::int AS wait FROM ingestion_jobs`,
      )
    ).rows;
    assert.equal(job.status, "PENDING");
    assert.match(job.error, /fetch failed \(ECONNREFUSED\)/);
    assert.ok(job.wait >= 55, `wait ${job.wait}`);

    for (let attempt = 2; attempt <= 3; attempt++) {
      await app.db.query(`UPDATE ingestion_jobs SET "runAfter"=now()`);
      assert.equal(await broken.processOne(), true);
    }
    let [item] = (await app.service.manifest(batch.id)).items;
    assert.equal(item.status, "FAILED");
    assert.match(item.error!, /ECONNREFUSED/);

    const { retried } = await app.service.retryFailed(batch.id);
    assert.equal(retried, 1);
    await app.drain();
    const manifest = await app.service.manifest(batch.id);
    [item] = manifest.items;
    assert.equal(item.status, "EXTRACTED");
    assert.equal(manifest.complete, true);
    assert.equal((await app.service.retryFailed(batch.id)).retried, 0);
  } finally {
    await app.close();
  }
});

test("처리 중지는 대기 작업을 취소하고, 다시 처리로 재개된다", async () => {
  const app = await setup();
  try {
    const batch = await app.service.createBatch({ mode: "FILES" });
    await app.upload(batch.id, "a.md", "# a\n");
    await app.upload(batch.id, "b.md", "# b\n");
    await app.service.finalize(batch.id);

    const { cancelled, manifest } = await app.service.cancel(batch.id);
    assert.equal(cancelled, 2);
    assert.equal(manifest.counts.CANCELLED, 2);
    assert.equal(manifest.pendingJobs, 0);
    assert.equal(await app.worker().processOne(), false);

    assert.equal((await app.service.retryFailed(batch.id)).retried, 2);
    await app.drain();
    const done = await app.service.manifest(batch.id);
    assert.equal(done.counts.EXTRACTED, 2);
    assert.equal(done.complete, true);
  } finally {
    await app.close();
  }
});

test("실행 중인 작업을 중지하면 모델 호출이 중단되고 결과를 반영하지 않는다", async () => {
  const app = await setup();
  try {
    let sawAbort = false;
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    // Stands in for a long OCR call that only ends when its signal aborts.
    const slow: ContentExtractor = {
      name: "slow",
      version: "1",
      formats: ["MARKDOWN"],
      extract: ({ signal }) =>
        new Promise((_, reject) => {
          started();
          signal!.addEventListener("abort", () => {
            sawAbort = true;
            reject(signal!.reason);
          });
        }),
    };
    const worker = new IngestionWorker(
      app.store,
      app.artifacts,
      [slow],
      new ZipArchiveReader(),
      "slow-worker",
      () => {},
      20,
    );
    const batch = await app.service.createBatch({ mode: "FILES" });
    const item = await app.upload(batch.id, "doc.md", "# x\n");
    await app.service.finalize(batch.id);

    const processing = worker.processOne();
    await running;
    await app.service.cancel(batch.id);
    assert.equal(await processing, true);

    assert.equal(sawAbort, true);
    const [after] = (await app.service.manifest(batch.id)).items;
    assert.equal(after.status, "CANCELLED");
    assert.equal(await app.store.latestContent(item.id), null);
    const [job] = (
      await app.db.query<{ status: string }>(
        `SELECT status FROM ingestion_jobs`,
      )
    ).rows;
    assert.equal(job.status, "CANCELLED");
  } finally {
    await app.close();
  }
});
