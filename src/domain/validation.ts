import { z } from "zod";
import {
  collections,
  statuses,
  ruleTypes,
  expressionTypes,
  entityTypes,
  type Collection,
} from "./model";
const text = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(12000);
const json = z.record(z.string(), z.unknown());
const regex = z
  .string()
  .min(1)
  .max(2000)
  .refine((source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  }, "올바른 정규식이 아닙니다.");
const common = { status: z.enum(statuses).default("ACTIVE") };
export const termSchema = z
  .object({ name: text, definition: longText, domain: text, ...common })
  .strict();
export const expressionSchema = z
  .object({
    termId: z.uuid(),
    text,
    type: z.enum(expressionTypes).default("ALIAS"),
    ...common,
  })
  .strict();
export const conditions = {
  FORMAT: z
    .object({
      operator: z.literal("regex"),
      pattern: regex,
    })
    .strict(),
  MASKING: z
    .object({
      operator: z.literal("regex"),
      pattern: regex,
    })
    .strict(),
  REQUIRED: z.object({ operator: z.literal("exists") }).strict(),
  ENUM: z
    .object({
      operator: z.literal("in"),
      values: z.array(text).min(1).max(200),
    })
    .strict(),
  RANGE: z
    .object({
      operator: z.literal("between"),
      min: z.number(),
      max: z.number(),
    })
    .strict()
    .refine((v) => v.min <= v.max, "min은 max보다 클 수 없습니다."),
};
const baseActionSchema = z
  .object({
    onViolation: z.enum(["REPORT", "BLOCK", "WARN"]),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  })
  .strict();
const maskingActionSchema = baseActionSchema.extend({
  replacement: z.string().min(1).max(2000),
  resultPattern: regex,
});
export const ruleSchema = z
  .object({
    name: text,
    description: longText,
    ruleType: z.enum(ruleTypes),
    termId: z.uuid(),
    scope: json.default({}),
    condition: json,
    action: baseActionSchema.extend({
      replacement: z.string().min(1).max(2000).optional(),
      resultPattern: z.string().min(1).max(2000).optional(),
    }),
    priority: z.number().int().min(-2147483648).max(2147483647).default(100),
    ...common,
  })
  .strict();
export const schemas = {
  terms: termSchema,
  expressions: expressionSchema,
  rules: ruleSchema,
};
export const collectionSchema = z.enum(collections);
export const idSchema = z.uuid();
export function validateEntity(
  collection: Collection,
  input: unknown,
): Record<string, unknown> {
  const value = schemas[collection].parse(input);
  if (collection === "rules") {
    const rule = ruleSchema.parse(value);
    const conditionSchema =
      conditions[rule.ruleType as keyof typeof conditions];
    if (conditionSchema) conditionSchema.parse(rule.condition);
    const actionSchema =
      rule.ruleType === "MASKING" ? maskingActionSchema : baseActionSchema;
    const actionResult = actionSchema.safeParse(rule.action);
    if (!actionResult.success) {
      throw new z.ZodError(
        actionResult.error.issues.map((issue) => ({
          ...issue,
          path: ["action", ...issue.path],
        })),
      );
    }
  }
  return value;
}
export function validatePatch(
  collection: Collection,
  input: unknown,
): Record<string, unknown> {
  const value = schemas[collection].partial().parse(input);
  if (Object.keys(input as Record<string, unknown>).length === 0)
    throw new z.ZodError([
      { code: "custom", path: [], message: "수정할 필드가 필요합니다." },
    ]);
  // Zod defaults must not turn an omitted PATCH field into a write.
  return Object.fromEntries(
    Object.keys(input as Record<string, unknown>).map((key) => [
      key,
      value[key as keyof typeof value],
    ]),
  );
}
export const listSchema = z
  .object({
    q: z.string().max(500).optional(),
    domain: text.optional(),
    status: z.enum(statuses).optional(),
    termId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    types: z
      .array(z.enum(entityTypes))
      .min(1)
      .max(3)
      .default([...entityTypes]),
    domain: text.optional(),
    topK: z.number().int().min(1).max(100).default(10),
  })
  .strict();
