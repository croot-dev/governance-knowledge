import { AppError, type JsonObject } from "./model";

export interface DocumentTypeDef {
  id: string;
  code: string;
  name: string;
  definition: string;
  positiveExamples: string[];
  negativeExamples: string[];
  version: number;
}
export interface JobGradeDef {
  id: string;
  gradeSchemeId: string;
  code: string;
  name: string;
  rank: number;
  termId: string | null;
  version: number;
}
export interface TermDef {
  id: string;
  name: string;
  definition: string;
  domain: string;
  version: number;
  expressions: string[];
}
// Unlike ActiveRule, a snapshot carries everything needed to reproduce a later judgment.
export interface RuleSnapshot {
  id: string;
  termId: string;
  name: string;
  description: string;
  ruleType: string;
  scope: JsonObject;
  condition: JsonObject;
  action: JsonObject;
  priority: number;
  version: number;
  documentTypeCodes: string[];
}
export type Applicability = "APPLIES" | "NOT_APPLICABLE" | "UNDETERMINED";
export interface ApplicableRule {
  rule: RuleSnapshot;
  applicability: Applicability;
}

export const UNKNOWN_DOCUMENT_TYPE = "UNKNOWN";

// An unknown document type never makes a type-bound rule "not needed"; it stays undetermined.
export function resolveApplicability(
  rules: RuleSnapshot[],
  documentTypeCode: string,
): ApplicableRule[] {
  return rules.map((rule) => {
    if (!rule.documentTypeCodes.length)
      return { rule, applicability: "APPLIES" };
    if (documentTypeCode === UNKNOWN_DOCUMENT_TYPE)
      return { rule, applicability: "UNDETERMINED" };
    return {
      rule,
      applicability: rule.documentTypeCodes.includes(documentTypeCode)
        ? "APPLIES"
        : "NOT_APPLICABLE",
    };
  });
}

// "과장 이상" style ranges: only grades of the same scheme are ever compared.
export function gradesAtLeast(
  grades: JobGradeDef[],
  gradeSchemeId: string,
  code: string,
): JobGradeDef[] {
  const scheme = grades.filter((g) => g.gradeSchemeId === gradeSchemeId);
  const base = scheme.find((g) => g.code === code);
  if (!base)
    throw new AppError(
      404,
      "UNKNOWN_GRADE",
      `직급 체계 ${gradeSchemeId}에 ${code} 직급이 없습니다.`,
    );
  return scheme
    .filter((g) => g.rank >= base.rank)
    .sort((a, b) => a.rank - b.rank);
}
