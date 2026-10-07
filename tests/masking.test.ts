import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ZodError } from "zod";
import { validateEntity } from "../src/domain/validation";

const termId = "10000000-0000-4000-8000-000000000002";
const ruleId = "30000000-0000-4000-8000-000000000002";
const maskingRule = {
  termId,
  name: "주민등록번호 외부 노출 마스킹",
  description: "외부 문서에서는 주민등록번호 뒤 7자리를 마스킹해야 한다.",
  ruleType: "MASKING",
  condition: { operator: "regex", pattern: "^([0-9]{6})-?[0-9]{7}$" },
  action: {
    onViolation: "REPORT",
    severity: "HIGH",
    replacement: "$1-*******",
    resultPattern: "^[0-9]{6}-\\*{7}$",
  },
};

test("MASKING 규칙은 매칭 패턴과 수정 완료 패턴을 분리해 저장한다", () => {
  const rule = validateEntity("rules", maskingRule);
  const condition = rule.condition as { pattern: string };
  const action = rule.action as { replacement: string; resultPattern: string };
  const matching = new RegExp(condition.pattern);
  const completed = new RegExp(action.resultPattern);

  const masked = "900101-1234567".replace(matching, action.replacement);
  assert.equal(masked, "900101-*******");
  assert.ok(completed.test(masked));
  assert.ok(!matching.test(masked), "마스킹된 값은 다시 매칭되지 않아야 한다");
  assert.ok(!completed.test("900101-1234567"));
});

test("MASKING 규칙은 치환 형식과 수정 완료 패턴이 없으면 거부한다", () => {
  for (const key of ["replacement", "resultPattern"] as const) {
    const action = Object.fromEntries(
      Object.entries(maskingRule.action).filter(([k]) => k !== key),
    );
    assert.throws(
      () => validateEntity("rules", { ...maskingRule, action }),
      (error: unknown) =>
        error instanceof ZodError &&
        error.issues.some((i) => i.path.join(".") === `action.${key}`),
    );
  }
});

test("MASKING 외 규칙은 마스킹 전용 action 필드를 거부한다", () => {
  assert.throws(
    () =>
      validateEntity("rules", {
        ...maskingRule,
        ruleType: "FORMAT",
      }),
    ZodError,
  );
});

test("컴파일되지 않는 정규식은 거부한다", () => {
  assert.throws(
    () =>
      validateEntity("rules", {
        ...maskingRule,
        condition: { operator: "regex", pattern: "^([0-9]{6}" },
      }),
    ZodError,
  );
  assert.throws(
    () =>
      validateEntity("rules", {
        ...maskingRule,
        action: { ...maskingRule.action, resultPattern: "[" },
      }),
    ZodError,
  );
});

async function migration(name: string) {
  return readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

async function legacyDatabase(condition: unknown) {
  const pg = new PGlite();
  await pg.exec(await migration("001_initial.sql"));
  await pg.query(
    `INSERT INTO terms(id,name,"normalizedName",definition,domain) VALUES($1,'주민등록번호','주민등록번호','정의','CUSTOMER')`,
    [termId],
  );
  await pg.query(
    `INSERT INTO rules(id,"termId",name,description,"ruleType",condition,action) VALUES($1,$2,'n','d','MASKING',$3,$4)`,
    [
      ruleId,
      termId,
      JSON.stringify(condition),
      JSON.stringify({ onViolation: "REPORT", severity: "HIGH" }),
    ],
  );
  await pg.query(
    `INSERT INTO index_profiles(id,provider,model,dimensions,revision) VALUES('p1','mock','m',8,'r')`,
  );
  await pg.query(
    `INSERT INTO index_jobs("profileId","entityType","entityId",status) VALUES('p1','RULE',$1,'READY')`,
    [ruleId],
  );
  return pg;
}

test("002 migration은 기존 seed 마스킹 규칙을 분리된 패턴으로 바꾸고 재인덱싱한다", async () => {
  const pg = await legacyDatabase({
    operator: "mask",
    pattern: "######-*******",
  });
  await pg.exec(await migration("002_masking_patterns.sql"));

  const { rows } = await pg.query<{
    condition: unknown;
    action: Record<string, unknown>;
    version: number;
  }>("SELECT condition, action, version FROM rules WHERE id=$1", [ruleId]);
  assert.deepEqual(rows[0].condition, maskingRule.condition);
  assert.deepEqual(rows[0].action, maskingRule.action);
  assert.equal(rows[0].version, 2);
  validateEntity("rules", {
    ...maskingRule,
    condition: rows[0].condition,
    action: rows[0].action,
  });

  const jobs = await pg.query<{ status: string; revision: number }>(
    `SELECT status, revision FROM index_jobs WHERE "entityId"=$1`,
    [ruleId],
  );
  assert.deepEqual(jobs.rows, [{ status: "PENDING", revision: 2 }]);
  await pg.close();
});

test("002 migration은 사용자가 바꾼 마스킹 규칙을 건드리지 않는다", async () => {
  const custom = { operator: "mask", pattern: "###-****" };
  const pg = await legacyDatabase(custom);
  await pg.exec(await migration("002_masking_patterns.sql"));

  const { rows } = await pg.query<{ condition: unknown; version: number }>(
    "SELECT condition, version FROM rules WHERE id=$1",
    [ruleId],
  );
  assert.deepEqual(rows[0], { condition: custom, version: 1 });
  const jobs = await pg.query<{ status: string }>(
    `SELECT status FROM index_jobs WHERE "entityId"=$1`,
    [ruleId],
  );
  assert.deepEqual(jobs.rows, [{ status: "READY" }]);
  await pg.close();
});
