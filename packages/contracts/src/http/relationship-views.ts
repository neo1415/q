import { z } from "zod";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  RelationshipStateV2Schema,
  RelationshipSummaryDtoSchema,
} from "./relationships.js";

/** Presentation preferences only; never relationship facts or disclosure rights. */
export const RelationshipViewDefinitionSchema = z
  .object({
    nameQuery: z.string().trim().max(100).default(""),
    states: z.array(RelationshipStateV2Schema).max(9).default([]),
    sort: z.enum(["RECENT", "OLDEST", "NAME"]).default("RECENT"),
    presentation: z.enum(["BOARD", "TABLE"]).default("BOARD"),
    columns: z
      .array(z.enum(["NAME", "STATE", "SINCE", "NEXT_STEP"]))
      .min(1)
      .max(4)
      .default(["NAME", "STATE", "SINCE", "NEXT_STEP"]),
  })
  .strict();
export type RelationshipViewDefinition = z.infer<
  typeof RelationshipViewDefinitionSchema
>;
export const RelationshipQuerySchema = z
  .object({
    ...RelationshipViewDefinitionSchema.shape,
    cursor: z.string().max(180).nullable().default(null),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    companyId: UuidSchema.optional(),
  })
  .strict();
export type RelationshipQuery = z.infer<typeof RelationshipQuerySchema>;
export const RelationshipQueryResponseSchema = z
  .object({
    items: z.array(RelationshipSummaryDtoSchema).max(50),
    nextCursor: z.string().nullable(),
    /** Initial source is the existing authorized list (bounded to 200 records). */
    sourceLimit: z.literal(200),
    sourceMayBeTruncated: z.boolean(),
  })
  .strict();
export const SavedRelationshipViewSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(80),
    scope: z.enum(["PERSONAL", "ORGANISATION"]),
    definition: RelationshipViewDefinitionSchema,
    version: z.number().int().positive(),
    updatedAt: UtcTimestampSchema,
    editable: z.boolean(),
  })
  .strict();
export type SavedRelationshipView = z.infer<typeof SavedRelationshipViewSchema>;
export const SaveRelationshipViewRequestSchema = z
  .object({
    name: SavedRelationshipViewSchema.shape.name,
    scope: SavedRelationshipViewSchema.shape.scope,
    definition: RelationshipViewDefinitionSchema,
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const SavedRelationshipViewListSchema = z
  .object({ items: z.array(SavedRelationshipViewSchema).max(100) })
  .strict();
export const RelationshipExportRequestSchema = z
  .object({
    query: RelationshipQuerySchema.omit({ cursor: true, limit: true }),
    selectedIds: z.array(UuidSchema).min(1).max(200).optional(),
  })
  .strict();
export const NETWORK_RELATIONSHIP_QUERY_PATH =
  "/v1/network/relationship-query" as const;
export const NETWORK_RELATIONSHIP_VIEWS_PATH =
  "/v1/network/relationship-views" as const;
export const NETWORK_RELATIONSHIP_VIEW_PATH =
  "/v1/network/relationship-views/:viewId" as const;
export const NETWORK_RELATIONSHIP_EXPORT_PATH =
  "/v1/network/relationship-export" as const;
export const RelationshipExportResponseSchema = z
  .object({
    fileName: z.literal("relationships.csv"),
    csv: z.string().max(300000),
    sourceLimit: z.literal(200),
    sourceMayBeTruncated: z.boolean(),
  })
  .strict();
export const DeleteRelationshipViewRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const DeleteRelationshipViewResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
