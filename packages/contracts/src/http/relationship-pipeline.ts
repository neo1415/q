import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  RelationshipSummaryDtoSchema,
  RelationshipStateV2Schema,
} from "./relationships.js";

export const NETWORK_INVESTOR_PIPELINE_PATH =
  "/v1/network/relationships/pipeline" as const;
export const NETWORK_COMPANY_PIPELINE_PATH =
  "/v1/network/companies/:companyId/relationships/pipeline" as const;
export const RelationshipPipelineQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    state: RelationshipStateV2Schema.optional(),
    sort: z.enum(["recent", "oldest", "name", "name-desc"]).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
export type RelationshipPipelineQuery = z.infer<
  typeof RelationshipPipelineQuerySchema
>;

/**
 * The CRM's Unicorn Potential views (owner 2026-10-18): ranked by the
 * persisted, premium-gated assessment, highest first, optionally narrowed
 * to a score floor (the band edges), to scored companies only, or to those
 * with insufficient evidence. They are web views over the reader's own
 * authorised pipeline: the API never sees them (it has no scores), and a
 * saved view keeps one in its `sort`, so no stored key changes.
 */
export const PIPELINE_UNICORN_SORTS = [
  "unicorn",
  "unicorn-scored",
  "unicorn-40",
  "unicorn-60",
  "unicorn-80",
  "unicorn-insufficient",
] as const;
export type PipelineUnicornSort = (typeof PIPELINE_UNICORN_SORTS)[number];
export function isPipelineUnicornSort(
  value: unknown,
): value is PipelineUnicornSort {
  return (
    typeof value === "string" &&
    (PIPELINE_UNICORN_SORTS as readonly string[]).includes(value)
  );
}

/** The pipeline query as the web page reads it: the API's, or a Unicorn view. */
export const RelationshipPipelineViewQuerySchema =
  RelationshipPipelineQuerySchema.extend({
    sort: z
      .enum([
        "recent",
        "oldest",
        "name",
        "name-desc",
        ...PIPELINE_UNICORN_SORTS,
      ])
      .optional(),
  }).strict();
export type RelationshipPipelineViewQuery = z.infer<
  typeof RelationshipPipelineViewQuerySchema
>;
export const RelationshipPipelineDtoSchema = z
  .object({
    items: z.array(RelationshipSummaryDtoSchema).max(50),
    total: z.number().int().min(0),
    /**
     * False: `total` is an upper bound, because some rows beyond this page
     * have not yet been checked against the reader's current sight of the
     * counterpart. Absent: exact (older servers).
     */
    totalExact: z.boolean().optional(),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    nextCursor: z.string().max(1024).nullable(),
  })
  .strict();
export type RelationshipPipelineDto = z.infer<
  typeof RelationshipPipelineDtoSchema
>;
export const RelationshipPipelineExportQuerySchema =
  RelationshipPipelineQuerySchema.omit({ cursor: true, pageSize: true })
    .extend({
      scope: z.string().regex(/^[a-f0-9]{64}$/),
      selected: z
        .string()
        .max(8192)
        .optional()
        .transform((value) => (value === undefined ? [] : value.split(",")))
        .pipe(z.array(UuidSchema).max(200)),
    })
    .strict();
export type RelationshipPipelineExportQuery = z.infer<
  typeof RelationshipPipelineExportQuerySchema
>;
