import { z } from "zod";

// Each option has a fixed apply policy; changes to facts or added knowledge always need review.
export const enrichmentOptions = {
  ANNOTATE: { mutatesContent: false, requiresReview: false },
  STANDARDIZE: { mutatesContent: true, requiresReview: true },
  MASK: { mutatesContent: true, requiresReview: false },
  ADD_GROUNDED_NOTE: { mutatesContent: true, requiresReview: true },
} as const;
export type EnrichmentOption = keyof typeof enrichmentOptions;
export const enrichmentOptionSchema = z.enum(
  Object.keys(enrichmentOptions) as [EnrichmentOption, ...EnrichmentOption[]],
);

// CONFIRMED comes from deterministic structure or a reviewer; model output is at most INFERRED.
export const resolutions = ["CONFIRMED", "INFERRED", "UNKNOWN"] as const;
export type Resolution = (typeof resolutions)[number];

export const ruleOutcomes = [
  "PASS",
  "VIOLATION",
  "UNKNOWN",
  "NOT_APPLICABLE",
] as const;
export type RuleOutcome = (typeof ruleOutcomes)[number];

// Input evidence points into the analysed document; source evidence into approved reference knowledge.
export const evidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("INPUT"),
      blockId: z.string(),
      cellId: z.string().optional(),
      quote: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SOURCE"),
      sourceId: z.string(),
      sourceVersion: z.string(),
      chunkId: z.string(),
    })
    .strict(),
]);
export type Evidence = z.infer<typeof evidenceSchema>;

export const linkMethods = ["HEADER", "KEY_VALUE", "MENTION", "MODEL"] as const;

export const entityLinkSchema = z
  .object({
    blockId: z.string(),
    cellId: z.string().optional(),
    // Character range of the linked value inside the block or cell text.
    span: z
      .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
      .strict(),
    value: z.string(),
    termId: z.string(),
    method: z.enum(linkMethods),
    resolution: z.enum(resolutions),
    evidence: z.array(evidenceSchema).min(1),
  })
  .strict();
export type EntityLink = z.infer<typeof entityLinkSchema>;

export const documentTypeResolutionSchema = z
  .object({
    code: z.string().nullable(),
    resolution: z.enum(resolutions),
    evidence: z.array(evidenceSchema),
  })
  .strict()
  .refine(
    (v) => (v.resolution === "UNKNOWN") === (v.code === null),
    "UNKNOWN이면 code가 없어야 하고, 그 외에는 code가 필요합니다.",
  );
