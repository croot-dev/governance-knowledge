import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GovernanceRepository } from "../src/infrastructure/db/repository";
import { MockEmbeddingProvider } from "../src/infrastructure/embedding/providers";
import { LanceVectorStore } from "../src/infrastructure/vector-store/lance";
import { GovernanceService } from "../src/application/governance";
import { IndexingService } from "../src/application/indexing";
import { SearchService } from "../src/application/search";
import { createTestDatabase } from "./helpers/db";
import type { EmbeddingProvider } from "../src/domain/ports";
import { AppError, ruleTypes } from "../src/domain/model";
import { seed } from "../scripts/seed";
import { DocumentTransformService } from "../src/application/transform";

async function setup() {
  const { pg, db } = await createTestDatabase();
  const embedding = new MockEmbeddingProvider();
  const repository = new GovernanceRepository(db, embedding.profile);
  await repository.initialize();
  const directory = await mkdtemp(join(tmpdir(), "governance-lance-"));
  const vectors = new LanceVectorStore(directory, embedding.profile);
  await vectors.initialize();
  const service = new GovernanceService(repository);
  const indexing = new IndexingService(repository, embedding, vectors);
  const search = new SearchService(repository, embedding, vectors);
  const drain = async (worker = indexing) => {
    for (let i = 0; i < 100; i++) {
      if (!(await worker.processOne())) return;
    }
    throw new Error("Worker did not converge");
  };
  return {
    db,
    repository,
    embedding,
    vectors,
    service,
    indexing,
    search,
    drain,
    directory,
    async close() {
      await pg.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const term = {
  name: "고객번호",
  definition: "고객을 식별하는 고유 번호",
  domain: "CUSTOMER",
};

test("원본과 작업이 함께 저장되고 임베딩 실패·중단 후 재시도로 복구된다", async () => {
  const app = await setup();
  try {
    const entity = await app.service.create("terms", term);
    const failing: EmbeddingProvider = {
      profile: app.embedding.profile,
      embedQuery: async () => {
        throw new Error("offline");
      },
      embedDocuments: async () => {
        throw new Error("offline");
      },
    };
    await new IndexingService(
      app.repository,
      failing,
      app.vectors,
    ).processOne();
    const saved = await app.service.get("terms", entity.id);
    assert.equal(saved.name, term.name);
    assert.equal(saved.embeddingStatus, "FAILED");
    assert.equal(saved.embeddingError, "offline");
    await app.repository.retry();
    const claimed = await app.repository.claim();
    assert.ok(claimed);
    assert.equal(
      (await app.service.get("terms", entity.id)).embeddingStatus,
      "PROCESSING",
    );
    await app.repository.recover();
    await app.drain();
    assert.equal(
      (await app.service.get("terms", entity.id)).embeddingStatus,
      "READY",
    );
    assert.equal(
      (await app.search.search({ query: term.name })).results[0]?.id,
      entity.id,
    );
    const before = await app.repository.list("terms", {
      page: 1,
      pageSize: 20,
    });
    await assert.rejects(
      app.db.transaction(async (sql) => {
        await sql.query(
          'INSERT INTO terms(id,name,"normalizedName",definition,domain) VALUES(gen_random_uuid(),$1,$1,$1,$1)',
          ["rollback"],
        );
        throw new Error("rollback");
      }),
    );
    assert.equal(
      (await app.repository.list("terms", { page: 1, pageSize: 20 })).total,
      before.total,
    );
  } finally {
    await app.close();
  }
});

test("임베딩·upsert 도중 변경과 중복 작업은 최신 원본 하나로 수렴한다", async () => {
  const app = await setup();
  try {
    const entity = await app.service.create("terms", term);
    let changed = false;
    const delayed: EmbeddingProvider = {
      profile: app.embedding.profile,
      embedQuery: (t) => app.embedding.embedQuery(t),
      embedDocuments: async (texts) => {
        if (!changed) {
          changed = true;
          await app.service.update("terms", entity.id, {
            name: "최신 고객번호",
          });
        }
        return app.embedding.embedDocuments(texts);
      },
    };
    const worker = new IndexingService(app.repository, delayed, app.vectors);
    await worker.processOne();
    assert.equal(
      (await app.service.get("terms", entity.id)).embeddingStatus,
      "PENDING",
    );
    await app.drain(worker);
    assert.equal(
      (await app.service.get("terms", entity.id)).embeddingStatus,
      "READY",
    );
    const original = app.vectors.upsert.bind(app.vectors);
    let raced = false;
    app.vectors.upsert = async (row) => {
      await original(row);
      if (!raced) {
        raced = true;
        await app.service.update("terms", entity.id, { name: "최종 고객번호" });
      }
    };
    await app.repository.enqueueAll();
    await app.indexing.processOne();
    assert.equal(
      (await app.service.get("terms", entity.id)).embeddingStatus,
      "PENDING",
    );
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      0,
    );
    await app.drain();
    await app.repository.enqueueAll();
    await app.drain();
    const results = (await app.search.search({ query: "고객번호" })).results;
    assert.equal(results.length, 1);
    assert.equal(results[0].text, "최종 고객번호");
    // A second connection sees committed writes, as the separate Next.js process does.
    const reader = new LanceVectorStore(app.directory, app.embedding.profile);
    assert.equal(
      (
        await reader.search(await app.embedding.embedQuery("고객번호"), {
          types: ["TERM"],
          limit: 10,
        })
      ).length,
      1,
    );
    await app.repository.enqueueAll();
    await app.vectors.clear();
    await app.drain();
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("지연된 인덱스에서도 부모 상태·domain·삭제를 원본으로 재검증한다", async () => {
  const app = await setup();
  try {
    const parent = await app.service.create("terms", term);
    const expression = await app.service.create("expressions", {
      termId: parent.id,
      text: "고객 ID",
    });
    const rule = await app.service.create("rules", {
      termId: parent.id,
      name: "형식",
      description: "형식 규칙",
      ruleType: "FORMAT",
      condition: { operator: "regex", pattern: "^CUST-" },
      action: { onViolation: "REPORT", severity: "MEDIUM" },
    });
    await app.drain();
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      3,
    );
    await assert.rejects(
      app.service.delete("terms", parent.id),
      (e: unknown) => e instanceof AppError && e.status === 409,
    );
    await app.service.update("terms", parent.id, { status: "INACTIVE" });
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      0,
    );
    assert.equal(
      (await app.service.get("expressions", expression.id)).status,
      "ACTIVE",
    );
    await app.drain();
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      0,
    );
    await app.service.update("terms", parent.id, {
      status: "ACTIVE",
      domain: "CUST'OMER",
    });
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      0,
    );
    await app.drain();
    assert.equal(
      (await app.search.search({ query: "고객번호", domain: "CUST'OMER" }))
        .results.length,
      3,
    );
    assert.equal(
      (await app.search.search({ query: "고객번호", domain: "CUSTOMER" }))
        .results.length,
      0,
    );
    await app.service.delete("expressions", expression.id);
    await app.service.update("rules", rule.id, { status: "INACTIVE" });
    await app.service.update("rules", rule.id, { description: "설명만 수정" });
    assert.equal((await app.service.get("rules", rule.id)).status, "INACTIVE");
    assert.deepEqual(
      (await app.search.search({ query: "고객번호" })).results.map((r) => r.id),
      [parent.id],
    );
    await app.drain();
    await app.service.delete("rules", rule.id);
    await app.service.delete("terms", parent.id);
    assert.equal(
      (await app.search.search({ query: "고객번호" })).results.length,
      0,
    );
    await assert.rejects(
      app.service.create("expressions", {
        termId: parent.id,
        text: "삭제된 부모",
      }),
      (e: unknown) => e instanceof AppError && e.status === 409,
    );
    await app.drain();
  } finally {
    await app.close();
  }
});

test("seed는 모든 규칙 유형의 예제를 한 번씩만 저장한다", async () => {
  const app = await setup();
  try {
    await seed(app.repository);
    await seed(app.repository);
    const { rows } = await app.db.query<{ ruleType: string; count: number }>(
      `SELECT "ruleType", count(*)::int AS count FROM rules GROUP BY "ruleType" ORDER BY "ruleType"`,
    );
    assert.deepEqual(
      rows.map((r) => r.ruleType),
      [...ruleTypes].sort(),
    );
    assert.ok(rows.every((r) => r.count === 1));
  } finally {
    await app.close();
  }
});

test("문서 변환은 RDB의 활성 데이터만으로 seed 규칙을 적용한다", async () => {
  const app = await setup();
  try {
    await seed(app.repository);
    await app.service.update(
      "expressions",
      "20000000-0000-4000-8000-000000000003",
      {
        status: "INACTIVE",
      },
    );
    const result = await new DocumentTransformService(app.repository).transform(
      "doc.md",
      new TextEncoder().encode(
        "# 고객 정보\n- 회원번호: CUST-0000000001\n- 주민번호는 900101-1234567\n- Customer ID 확인",
      ),
    );
    assert.equal(
      result.markdown,
      "# 고객 정보\n- 회원번호: CUST-0000000001\n- 주민등록번호는 900101-*******\n- 고객번호 확인",
    );
    assert.deepEqual(result.skipped.map((s) => s.ruleType).sort(), [
      "CUSTOM",
      "ENUM",
      "FORMAT",
      "RANGE",
      "RELATION",
      "REQUIRED",
    ]);
  } finally {
    await app.close();
  }
});
