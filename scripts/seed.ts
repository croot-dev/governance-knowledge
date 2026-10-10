import { getPool, type Sql } from "../src/infrastructure/db/connection";
import { createRuntime } from "../src/infrastructure/runtime";
import type { GovernanceRepository } from "../src/infrastructure/db/repository";
import { validateEntity } from "../src/domain/validation";
import type { Collection } from "../src/domain/model";
export async function seed(repository: GovernanceRepository) {
  const add = async (
    collection: Collection,
    id: string,
    data: Record<string, unknown>,
  ) => {
    if (!(await repository.get(collection, id, repository.db, true)))
      await repository.create(collection, validateEntity(collection, data), id);
  };
  const customer = "10000000-0000-4000-8000-000000000001";
  const resident = "10000000-0000-4000-8000-000000000002";
  const grade = "10000000-0000-4000-8000-000000000003";
  const age = "10000000-0000-4000-8000-000000000004";
  const contract = "10000000-0000-4000-8000-000000000005";
  await add("terms", customer, {
    name: "고객번호",
    definition: "고객을 식별하기 위해 부여되는 고유 번호",
    domain: "CUSTOMER",
  });
  await add("terms", resident, {
    name: "주민등록번호",
    definition: "대한민국 주민에게 부여되는 개인 식별번호",
    domain: "CUSTOMER",
  });
  await add("terms", grade, {
    name: "고객등급",
    definition: "거래 실적에 따라 고객에게 부여되는 서비스 등급",
    domain: "CUSTOMER",
  });
  await add("terms", age, {
    name: "고객연령",
    definition: "생년월일 기준으로 계산한 고객의 만 나이",
    domain: "CUSTOMER",
  });
  await add("terms", contract, {
    name: "계약번호",
    definition: "고객과 체결한 계약을 식별하는 고유 번호",
    domain: "CONTRACT",
  });
  let i = 1;
  for (const [termId, texts] of [
    [customer, ["고객 ID", "고객 식별번호", "회원번호", "Customer ID"]],
    [resident, ["주민번호", "주민 등록 번호", "RRN"]],
    [grade, ["회원등급", "Customer Grade"]],
    [age, ["나이", "만 나이"]],
    [contract, ["계약 ID", "Contract No"]],
  ] as const) {
    for (const text of texts)
      await add(
        "expressions",
        `20000000-0000-4000-8000-${String(i++).padStart(12, "0")}`,
        { termId, text, type: text === "RRN" ? "ABBREVIATION" : "ALIAS" },
      );
  }
  await add("rules", "30000000-0000-4000-8000-000000000001", {
    termId: customer,
    name: "고객번호 형식 검증",
    description:
      "고객번호는 CUST- 접두사 뒤에 숫자 10자리가 오는 형식이어야 한다.",
    ruleType: "FORMAT",
    condition: { operator: "regex", pattern: "^CUST-[0-9]{10}$" },
    action: { onViolation: "REPORT", severity: "MEDIUM" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000002", {
    termId: resident,
    name: "주민등록번호 외부 노출 마스킹",
    description: "외부 문서에서는 주민등록번호 뒤 7자리를 마스킹해야 한다.",
    ruleType: "MASKING",
    scope: { document: "EXTERNAL" },
    condition: { operator: "regex", pattern: "^([0-9]{6})-?[0-9]{7}$" },
    action: {
      onViolation: "REPORT",
      severity: "HIGH",
      replacement: "$1-*******",
      resultPattern: "^[0-9]{6}-\\*{7}$",
    },
  });
  await add("rules", "30000000-0000-4000-8000-000000000003", {
    termId: customer,
    name: "고객번호 필수 입력",
    description: "고객 관련 데이터에는 고객번호가 반드시 존재해야 한다.",
    ruleType: "REQUIRED",
    scope: { table: "CUSTOMER" },
    condition: { operator: "exists" },
    action: { onViolation: "BLOCK", severity: "HIGH" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000004", {
    termId: grade,
    name: "고객등급 허용값",
    description: "고객등급은 정의된 등급 코드 중 하나여야 한다.",
    ruleType: "ENUM",
    condition: { operator: "in", values: ["VIP", "GOLD", "SILVER", "BRONZE"] },
    action: { onViolation: "REPORT", severity: "MEDIUM" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000005", {
    termId: age,
    name: "고객연령 유효 범위",
    description: "고객연령은 0세 이상 150세 이하여야 한다.",
    ruleType: "RANGE",
    condition: { operator: "between", min: 0, max: 150 },
    action: { onViolation: "WARN", severity: "LOW" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000006", {
    termId: resident,
    name: "주민등록번호 로그 저장 금지",
    description: "애플리케이션 로그에는 주민등록번호 원본을 저장하면 안 된다.",
    ruleType: "PROHIBITED",
    scope: { target: "LOG" },
    condition: { operator: "notContains", pattern: "[0-9]{6}-?[0-9]{7}" },
    action: { onViolation: "BLOCK", severity: "HIGH" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000007", {
    termId: contract,
    name: "계약번호-고객번호 연결",
    description: "모든 계약번호는 존재하는 고객번호 하나에 연결되어야 한다.",
    ruleType: "RELATION",
    condition: {
      operator: "references",
      targetTermId: customer,
      cardinality: "MANY_TO_ONE",
    },
    action: { onViolation: "REPORT", severity: "MEDIUM" },
  });
  await add("rules", "30000000-0000-4000-8000-000000000008", {
    termId: grade,
    name: "VIP 등급 성인 제한",
    description: "VIP 등급 고객은 만 19세 이상이어야 한다.",
    ruleType: "CUSTOM",
    condition: {
      operator: "expression",
      expression: "grade == 'VIP' implies age >= 19",
      variables: { grade, age },
    },
    action: { onViolation: "WARN", severity: "MEDIUM" },
  });
  await seedCatalog(repository.db);
}

// Document types and grades have no CRUD API yet; fixed ids keep the seed idempotent.
async function seedCatalog(db: Sql) {
  const documentTypes = [
    [
      "40000000-0000-4000-8000-000000000001",
      "EXTERNAL_SUBMISSION",
      "외부 제출 문서",
      "협력사·고객·기관 등 회사 밖으로 제출하거나 공유하는 문서",
      ["외부 협력사 제출용 고객 명세", "감독기관 제출 자료"],
      ["사내 회의록", "개발팀 내부 설계 메모"],
    ],
    [
      "40000000-0000-4000-8000-000000000002",
      "INTERNAL_AUDIT_REPORT",
      "내부 감사 리포트",
      "내부 감사 조직이 점검 대상·발견 사항·조치 계획을 기록한 보고서",
      ["2026년 상반기 개인정보 처리 실태 점검 결과"],
      ["외부 회계감사인 제출 자료"],
    ],
    [
      "40000000-0000-4000-8000-000000000003",
      "OPERATION_LOG",
      "운영 로그",
      "시스템이 자동으로 남긴 실행·오류·접근 기록",
      ["애플리케이션 오류 로그", "접근 기록"],
      ["장애 회고 문서"],
    ],
  ] as const;
  for (const [id, code, name, definition, positive, negative] of documentTypes)
    await db.query(
      `INSERT INTO document_types(id,code,name,definition,"positiveExamples","negativeExamples")
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [
        id,
        code,
        name,
        definition,
        JSON.stringify(positive),
        JSON.stringify(negative),
      ],
    );
  const grades = [
    ["STAFF", "사원"],
    ["ASSISTANT_MANAGER", "대리"],
    ["MANAGER", "과장"],
    ["DEPUTY_GENERAL_MANAGER", "차장"],
    ["GENERAL_MANAGER", "부장"],
  ];
  for (const [index, [code, name]] of grades.entries())
    await db.query(
      `INSERT INTO job_grades(id,"gradeSchemeId",code,name,rank) VALUES($1,'KR_STANDARD',$2,$3,$4)
      ON CONFLICT (id) DO NOTHING`,
      [
        `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        code,
        name,
        index + 1,
      ],
    );
  // The resident-number masking rule targets documents leaving the company.
  await db.query(
    `INSERT INTO rule_document_types("ruleId","documentTypeId") VALUES($1,$2) ON CONFLICT DO NOTHING`,
    [
      "30000000-0000-4000-8000-000000000002",
      "40000000-0000-4000-8000-000000000001",
    ],
  );
}
if (process.argv[1]?.endsWith("/seed.ts")) {
  try {
    const app = await createRuntime();
    await seed(app.repository);
    console.log("Seed complete. Run the worker to index.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}
