import { z } from "zod";
import { AppError } from "../domain/model";
import type { ActiveGovernancePort, ActiveRule } from "../domain/ports";
import {
  transformMarkdown,
  type DetectionSpec,
  type MaskingSpec,
  type TransformOutput,
} from "../domain/transform";
import { conditions } from "../domain/validation";

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

const maskingAction = z.object({
  replacement: z.string().min(1),
  resultPattern: z.string().min(1),
});
const prohibitedCondition = z.object({
  operator: z.literal("notContains"),
  pattern: z.string().min(1),
});

export interface SkippedRule {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  reason: string;
}
export interface DocumentTransformResult extends TransformOutput {
  fileName: string;
  skipped: SkippedRule[];
}

function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(
      400,
      "INVALID_ENCODING",
      "UTF-8 Markdown 파일만 지원합니다.",
    );
  }
}

function classify(rules: ActiveRule[]) {
  const masking: MaskingSpec[] = [];
  const prohibited: DetectionSpec[] = [];
  const skipped: SkippedRule[] = [];
  for (const rule of rules) {
    const base = { ruleId: rule.id, ruleName: rule.name };
    const skip = (reason: string) =>
      skipped.push({ ...base, ruleType: rule.ruleType, reason });
    if (rule.ruleType === "MASKING") {
      const condition = conditions.MASKING.safeParse(rule.condition);
      const action = maskingAction.safeParse(rule.action);
      if (condition.success && action.success)
        masking.push({
          ...base,
          pattern: condition.data.pattern,
          ...action.data,
        });
      else skip("매칭 패턴·치환 형식·수정 완료 패턴이 모두 필요합니다.");
    } else if (rule.ruleType === "PROHIBITED") {
      const condition = prohibitedCondition.safeParse(rule.condition);
      if (condition.success)
        prohibited.push({ ...base, pattern: condition.data.pattern });
      else skip("notContains 패턴이 있는 금지 규칙만 탐지합니다.");
    } else skip("문서의 값과 용어의 연결이 필요해 자동 변환하지 않습니다.");
  }
  return { masking, prohibited, skipped };
}

export class DocumentTransformService {
  constructor(private governance: ActiveGovernancePort) {}
  async transform(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<DocumentTransformResult> {
    if (!MARKDOWN_FILE.test(fileName))
      throw new AppError(
        400,
        "INVALID_FILE_TYPE",
        ".md 파일만 업로드할 수 있습니다.",
      );
    if (bytes.byteLength > MAX_DOCUMENT_BYTES)
      throw new AppError(413, "FILE_TOO_LARGE", "파일은 1MB 이하여야 합니다.");
    const markdown = decode(bytes);
    const active = await this.governance.loadActive();
    const { masking, prohibited, skipped } = classify(active.rules);
    return {
      fileName,
      ...transformMarkdown(markdown, {
        expressions: active.expressions,
        masking,
        prohibited,
      }),
      skipped,
    };
  }
}
