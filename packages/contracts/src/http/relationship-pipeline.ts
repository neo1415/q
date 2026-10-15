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
