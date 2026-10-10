import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabase } from "./helpers/db";
import { seed } from "../scripts/seed";
import { GovernanceRepository } from "../src/infrastructure/db/repository";
import { CatalogRepository } from "../src/infrastructure/db/catalog";
import { MockEmbeddingProvider } from "../src/infrastructure/embedding/providers";
import { GovernanceService } from "../src/application/governance";
import { GovernanceCatalogService } from "../src/application/catalog";
import { AppError } from "../src/domain/model";

const CUSTOMER = "10000000-0000-4000-8000-000000000001";
const RESIDENT = "10000000-0000-4000-8000-000000000002";
const MASKING = "30000000-0000-4000-8000-000000000002";
const PROHIBITED = "30000000-0000-4000-8000-000000000006";

async function setup() {
  const { pg, db } = await createTestDatabase();
  const repository = new GovernanceRepository(
    db,
    new MockEmbeddingProvider().profile,
  );
  await repository.initialize();
  await seed(repository);
  return {
    db,
    governance: new GovernanceService(repository),
    catalog: new GovernanceCatalogService(new CatalogRepository(db)),
    close: () => pg.close(),
  };
}

test("문서 유형에 묶인 규칙은 유형이 UNKNOWN이면 불필요가 아니라 미확정으로 남는다", async () => {
  const app = await setup();
  try {
    const applicability = async (documentType?: string) =>
      Object.fromEntries(
        (
          await app.catalog.applicableRules({
            termIds: [RESIDENT],
            ...(documentType ? { documentType } : {}),
          })
        ).rules.map((r) => [r.rule.id, r.applicability]),
      );
    assert.deepEqual(await applicability("EXTERNAL_SUBMISSION"), {
      [MASKING]: "APPLIES",
      [PROHIBITED]: "APPLIES",
    });
    assert.deepEqual(await applicability("INTERNAL_AUDIT_REPORT"), {
      [MASKING]: "NOT_APPLICABLE",
      [PROHIBITED]: "APPLIES",
    });
    assert.deepEqual(await applicability(), {
      [MASKING]: "UNDETERMINED",
      [PROHIBITED]: "APPLIES",
    });
    await assert.rejects(
      applicability("NO_SUCH_TYPE"),
      (e: unknown) =>
        e instanceof AppError && e.code === "UNKNOWN_DOCUMENT_TYPE",
    );
  } finally {
    await app.close();
  }
});

test("규칙 스냅샷은 Term 정의·표현과 함께 버전·우선순위·범위를 담는다", async () => {
  const app = await setup();
  try {
    const result = await app.catalog.applicableRules({
      termIds: [CUSTOMER],
      documentType: "EXTERNAL_SUBMISSION",
    });
    assert.deepEqual(result.terms[0].expressions, [
      "Customer ID",
      "고객 ID",
      "고객 식별번호",
      "회원번호",
    ]);
    const [first] = result.rules;
    assert.equal(first.rule.termId, CUSTOMER);
    assert.equal(first.rule.version, 1);
    assert.equal(typeof first.rule.priority, "number");
    assert.deepEqual(first.rule.documentTypeCodes, []);
  } finally {
    await app.close();
  }
});

test("Rule을 수정해도 과거 버전 내용을 그대로 재현할 수 있다", async () => {
  const app = await setup();
  try {
    await app.governance.update("rules", MASKING, {
      condition: { operator: "regex", pattern: "^([0-9]{6})[0-9]{7}$" },
    });
    const v1 = await app.catalog.ruleVersion(MASKING, "1");
    const v2 = await app.catalog.ruleVersion(MASKING, "2");
    assert.deepEqual(v1.condition, {
      operator: "regex",
      pattern: "^([0-9]{6})-?[0-9]{7}$",
    });
    assert.deepEqual(v2.condition, {
      operator: "regex",
      pattern: "^([0-9]{6})[0-9]{7}$",
    });
    await app.governance.delete("rules", MASKING);
    assert.ok((await app.catalog.ruleVersion(MASKING, "3")).deletedAt);
    await assert.rejects(app.catalog.ruleVersion(MASKING, "9"), AppError);
  } finally {
    await app.close();
  }
});

test("'과장 이상'은 같은 직급 체계 안에서만 순서로 해석한다", async () => {
  const app = await setup();
  try {
    await app.db.query(
      `INSERT INTO job_grades(id,"gradeSchemeId",code,name,rank)
      VALUES('60000000-0000-4000-8000-000000000001','RESEARCH','MANAGER','책임',9)`,
    );
    const range = await app.catalog.gradeRange({
      gradeSchemeId: "KR_STANDARD",
      atLeast: "MANAGER",
    });
    assert.deepEqual(
      range.map((g) => g.name),
      ["과장", "차장", "부장"],
    );
    await assert.rejects(
      app.catalog.gradeRange({ gradeSchemeId: "KR_STANDARD", atLeast: "CEO" }),
      (e: unknown) => e instanceof AppError && e.code === "UNKNOWN_GRADE",
    );
  } finally {
    await app.close();
  }
});
