import { z } from "zod";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { RelationshipPipelineQuerySchema } from "./relationship-pipeline.js";

/** Presentation preferences only: no record IDs, evidence, notes or access grants. */
export const PipelineColumnsSchema = z
  .array(z.enum(["state", "since", "next"]))
  .max(3)
  .refine((values) => new Set(values).size === values.length);
export type PipelineColumn = z.infer<typeof PipelineColumnsSchema>[number];
export const PipelineSavedViewSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(64),
    query: RelationshipPipelineQuerySchema.omit({ cursor: true }),
    layout: z.enum(["table", "board"]),
    columns: PipelineColumnsSchema,
  })
  .strict();
export type PipelineSavedView = z.infer<typeof PipelineSavedViewSchema>;
export const SavedRelationshipViewSchema = PipelineSavedViewSchema.extend({
  scope: z.enum(["PERSONAL", "ORGANISATION"]),
  version: z.number().int().positive(),
  updatedAt: UtcTimestampSchema,
  editable: z.boolean(),
}).strict();
export type SavedRelationshipView = z.infer<typeof SavedRelationshipViewSchema>;
export const SaveRelationshipViewRequestSchema = PipelineSavedViewSchema.omit({
  id: true,
})
  .extend({
    scope: SavedRelationshipViewSchema.shape.scope,
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const SavedRelationshipViewListSchema = z
  .object({
    items: z.array(SavedRelationshipViewSchema).max(40),
    teamEditable: z.boolean(),
  })
  .strict();
export const DeleteRelationshipViewRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const DeleteRelationshipViewResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
export const NETWORK_RELATIONSHIP_VIEWS_PATH =
  "/v1/network/relationship-views" as const;
export const NETWORK_RELATIONSHIP_VIEW_PATH =
  "/v1/network/relationship-views/:viewId" as const;
export const NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH =
  "/v1/network/companies/:companyId/relationship-views" as const;
export const NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH =
  "/v1/network/companies/:companyId/relationship-views/:viewId" as const;
