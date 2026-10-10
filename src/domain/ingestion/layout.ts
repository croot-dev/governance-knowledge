import { z } from "zod";
import { bboxSchema, regionTypes } from "./content";

// What a vision model must return when describing an image's layout. Validated before use.
export const layoutSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    regions: z
      .array(
        z
          .object({
            type: z.enum(regionTypes),
            label: z.string().trim().min(1).max(200),
            bbox: bboxSchema,
            description: z.string().trim().max(1000).optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Layout = z.infer<typeof layoutSchema>;

// "COMPLETE" requires a normal stop and a schema-valid layout; anything else is never presented as a result.
export type LayoutResult =
  | { status: "COMPLETE"; layout: Layout; model: string }
  | { status: "TRUNCATED" | "INVALID"; reason: string; model: string };
