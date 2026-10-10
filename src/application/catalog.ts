import { z } from "zod";
import {
  UNKNOWN_DOCUMENT_TYPE,
  gradesAtLeast,
  resolveApplicability,
} from "../domain/catalog";
import { AppError } from "../domain/model";
import type { GovernanceCatalog } from "../domain/ports";

const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const applicableRulesSchema = z
  .object({
    termIds: z.array(z.uuid()).min(1).max(200),
    documentType: code.default(UNKNOWN_DOCUMENT_TYPE),
  })
  .strict();
const gradeRangeSchema = z
  .object({ gradeSchemeId: z.string().min(1).max(100), atLeast: code })
  .strict();

export class GovernanceCatalogService {
  constructor(private catalog: GovernanceCatalog) {}

  documentTypes() {
    return this.catalog.listDocumentTypes();
  }

  jobGrades(gradeSchemeId?: string) {
    return this.catalog.listJobGrades(
      gradeSchemeId ? z.string().max(100).parse(gradeSchemeId) : undefined,
    );
  }

  async gradeRange(input: unknown) {
    const { gradeSchemeId, atLeast } = gradeRangeSchema.parse(input);
    return gradesAtLeast(
      await this.catalog.listJobGrades(gradeSchemeId),
      gradeSchemeId,
      atLeast,
    );
  }

  async applicableRules(input: unknown) {
    const { termIds, documentType } = applicableRulesSchema.parse(input);
    if (documentType !== UNKNOWN_DOCUMENT_TYPE) {
      const known = await this.catalog.listDocumentTypes();
      if (!known.some((d) => d.code === documentType))
        throw new AppError(
          404,
          "UNKNOWN_DOCUMENT_TYPE",
          `등록되지 않은 문서 유형입니다: ${documentType}`,
        );
    }
    const [terms, rules] = await Promise.all([
      this.catalog.getTerms(termIds),
      this.catalog.activeRulesForTerms(termIds),
    ]);
    return {
      documentType,
      terms,
      rules: resolveApplicability(rules, documentType),
    };
  }

  async ruleVersion(ruleId: string, version: string) {
    const content = await this.catalog.getRuleVersion(
      z.uuid().parse(ruleId),
      z.coerce.number().int().min(1).parse(version),
    );
    if (!content)
      throw new AppError(404, "NOT_FOUND", "해당 Rule 버전이 없습니다.");
    return content;
  }
}
