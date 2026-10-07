import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustParticle, transformMarkdown } from "../src/domain/transform";
import { DocumentTransformService } from "../src/application/transform";
import type { ActiveGovernance } from "../src/domain/ports";
import { AppError } from "../src/domain/model";

const resident = { termId: "t-rrn", termName: "주민등록번호" };
const age = { termId: "t-age", termName: "고객연령" };
const input = {
  expressions: [
    { text: "주민번호", ...resident },
    { text: "RRN", ...resident },
    { text: "주민 등록 번호", ...resident },
    { text: "나이", ...age },
  ],
  masking: [
    {
      ruleId: "r-mask",
      ruleName: "주민등록번호 마스킹",
      pattern: "^([0-9]{6})-?[0-9]{7}$",
      replacement: "$1-*******",
      resultPattern: "^[0-9]{6}-\\*{7}$",
    },
  ],
  prohibited: [],
};

test("비표준 표현을 표준 용어로 바꾸고 조사를 맞춘다", () => {
  const result = transformMarkdown(
    "주민번호는 필수이고 RRN은 숨긴다. 나이는 19세 이상, 나이를 확인한다.",
    input,
  );
  assert.equal(
    result.markdown,
    "주민등록번호는 필수이고 주민등록번호는 숨긴다. 고객연령은 19세 이상, 고객연령을 확인한다.",
  );
  assert.deepEqual(
    result.replacements.map((r) => [r.from, r.to, r.count]),
    [
      ["주민번호", "주민등록번호", 1],
      ["RRN", "주민등록번호", 1],
      ["나이", "고객연령", 2],
    ],
  );
});

test("다른 단어의 일부, 코드, 링크 주소는 바꾸지 않는다", () => {
  const md = [
    "나이스 평가와 RRNX 값, 아나이 표기는 그대로 둔다.",
    "`주민번호` 와 [주민번호](https://x.io/주민번호) 링크",
    "```sql",
    "SELECT 주민번호 FROM t;",
    "```",
    "",
  ].join("\n");
  const result = transformMarkdown(md, input);
  assert.equal(result.markdown, md.replace("[주민번호]", "[주민등록번호]"));
});

test("공백이 다른 표현과 대소문자가 다른 약어도 찾는다", () => {
  const result = transformMarkdown("주민  등록 번호, rrn", input);
  assert.equal(result.markdown, "주민등록번호, 주민등록번호");
});

test("주민등록번호 값은 코드 블록 안에서도 마스킹하고 이미 마스킹된 값은 건드리지 않는다", () => {
  const md =
    "번호 900101-1234567, 9001011234567\n```\nrrn=850505-2345678\n```\n완료 900101-*******\n전화 1900101-12345678";
  const result = transformMarkdown(md, input);
  assert.equal(
    result.markdown,
    "번호 900101-*******, 900101-*******\n```\nrrn=850505-*******\n```\n완료 900101-*******\n전화 1900101-12345678",
  );
  assert.deepEqual(result.maskings, [
    { ruleId: "r-mask", ruleName: "주민등록번호 마스킹", count: 3 },
  ]);
});

test("치환 결과가 수정 완료 패턴과 맞지 않으면 원본을 유지하고 오류를 보고한다", () => {
  const result = transformMarkdown("900101-1234567", {
    ...input,
    masking: [{ ...input.masking[0], replacement: "$1-XXXXXXX" }],
  });
  assert.equal(result.markdown, "900101-1234567");
  assert.equal(result.errors.length, 1);
});

test("여러 용어에 연결된 표현은 바꾸지 않고 모호한 표현으로 보고한다", () => {
  const result = transformMarkdown("ID를 확인", {
    ...input,
    expressions: [
      { text: "ID", termId: "a", termName: "고객번호" },
      { text: "id", termId: "b", termName: "계약번호" },
    ],
  });
  assert.equal(result.markdown, "ID를 확인");
  assert.deepEqual(result.ambiguous, [
    { text: "ID", termNames: ["고객번호", "계약번호"] },
  ]);
});

test("금지 규칙은 마스킹 후에도 남은 위반만 보고한다", () => {
  const result = transformMarkdown("900101-1234567 그리고 900101 1234567", {
    ...input,
    prohibited: [
      { ruleId: "r-p", ruleName: "로그 금지", pattern: "[0-9]{6} [0-9]{7}" },
    ],
  });
  assert.deepEqual(result.violations, [
    { ruleId: "r-p", ruleName: "로그 금지", count: 1 },
  ]);
});

test("받침에 따라 조사를 고른다", () => {
  assert.equal(adjustParticle("고객연령", "는"), "은");
  assert.equal(adjustParticle("주민등록번호", "은"), "는");
  assert.equal(adjustParticle("계약번호", "을"), "를");
  assert.equal(adjustParticle("고객등급", "로"), "으로");
  assert.equal(adjustParticle("고객번호 목록", "으로"), "으로");
  assert.equal(adjustParticle("Customer ID", "는"), "는");
});

const active: ActiveGovernance = {
  expressions: input.expressions,
  rules: [
    {
      id: "r-mask",
      name: "주민등록번호 마스킹",
      ruleType: "MASKING",
      condition: { operator: "regex", pattern: input.masking[0].pattern },
      action: {
        onViolation: "REPORT",
        severity: "HIGH",
        replacement: "$1-*******",
        resultPattern: "^[0-9]{6}-\\*{7}$",
      },
    },
    {
      id: "r-range",
      name: "연령 범위",
      ruleType: "RANGE",
      condition: { operator: "between", min: 0, max: 150 },
      action: { onViolation: "WARN", severity: "LOW" },
    },
  ],
};
const service = new DocumentTransformService({
  loadActive: async () => active,
});
const bytes = (text: string) => new TextEncoder().encode(text);

test("서비스는 활성 규칙을 적용하고 적용하지 않은 규칙을 이유와 함께 보고한다", async () => {
  const result = await service.transform(
    "doc.md",
    bytes("주민번호: 900101-1234567"),
  );
  assert.equal(result.markdown, "주민등록번호: 900101-*******");
  assert.deepEqual(
    result.skipped.map((s) => s.ruleId),
    ["r-range"],
  );
});

test("서비스는 .md가 아니거나 UTF-8이 아니거나 1MB를 넘는 파일을 거부한다", async () => {
  const rejects = (name: string, data: Uint8Array, code: string) =>
    assert.rejects(
      service.transform(name, data),
      (e: unknown) => e instanceof AppError && e.code === code,
    );
  await rejects("doc.txt", bytes("x"), "INVALID_FILE_TYPE");
  await rejects("doc.md", new Uint8Array([0xff, 0xfe]), "INVALID_ENCODING");
  await rejects("doc.md", new Uint8Array(1024 * 1024 + 1), "FILE_TOO_LARGE");
});
