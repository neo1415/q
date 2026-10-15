import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { RelationshipPipelineQuerySchema } from "./relationship-pipeline.js";

/**
 * CRM saved views (owner directive 2026-10-15 §D): a named pipeline filter,
 * its layout and its columns, kept on the server for the person
 * (PERSONAL) or shared with their workspace (ORGANISATION).
 *
 * Presentation preferences only. A view holds no record id, selection,
 * cursor, note, evidence or access grant: opening one re-runs the same
 * authorised pipeline query, so a shared view never shows a teammate
 * anything their own access would not.
 */

/** The pipeline table's optional columns; the counterpart is always shown. */
export const PIPELINE_COLUMNS = ["state", "since", "next"] as const;
export const PipelineColumnsSchema = z
  .array(z.enum(PIPELINE_COLUMNS))
  .max(PIPELINE_COLUMNS.length)
  .refine((values) => new Set(values).size === values.length, {
    message: "Each column once",
  });
export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

export const RelationshipViewQuerySchema = RelationshipPipelineQuerySchema.omit(
  { cursor: true },
);

export const RELATIONSHIP_VIEW_SCOPES = ["PERSONAL", "ORGANISATION"] as const;
export const RelationshipViewScopeSchema = z.enum(RELATIONSHIP_VIEW_SCOPES);
export type RelationshipViewScope = z.infer<typeof RelationshipViewScopeSchema>;

/** How many views of each scope one workspace side may keep. */
export const RELATIONSHIP_VIEW_LIMIT = 20;

export const SavedRelationshipViewSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(64),
    query: RelationshipViewQuerySchema,
    layout: z.enum(["table", "board"]),
    columns: PipelineColumnsSchema,
    scope: RelationshipViewScopeSchema,
    version: z.number().int().positive(),
    updatedAt: UtcTimestampSchema,
    /** Whether this person may rename or delete it (server-decided). */
    editable: z.boolean(),
  })
  .strict();
export type SavedRelationshipView = z.infer<typeof SavedRelationshipViewSchema>;

/**
 * Create (expectedVersion 0, a client-chosen id, idempotent on retry) or
 * update (compare-and-swap on version). The scope never changes after
 * creation.
 */
export const SaveRelationshipViewRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    query: RelationshipViewQuerySchema,
    layout: z.enum(["table", "board"]),
    columns: PipelineColumnsSchema,
    scope: RelationshipViewScopeSchema,
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type SaveRelationshipViewRequest = z.infer<
  typeof SaveRelationshipViewRequestSchema
>;

export const SavedRelationshipViewListSchema = z
  .object({
    items: z
      .array(SavedRelationshipViewSchema)
      .max(RELATIONSHIP_VIEW_LIMIT * 2),
    /** Whether this person may create and change workspace views. */
    teamEditable: z.boolean(),
  })
  .strict();
export type SavedRelationshipViewList = z.infer<
  typeof SavedRelationshipViewListSchema
>;

/**
 * Delete is compare-and-swap too: the path names the version the person
 * last saw (`.../:viewId/versions/:version`), so no DELETE body is needed.
 */
export const RelationshipViewVersionSchema = z.coerce.number().int().positive();
export const DeleteRelationshipViewResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();

export const NETWORK_RELATIONSHIP_VIEWS_PATH =
  "/v1/network/relationship-views" as const;
export const NETWORK_RELATIONSHIP_VIEW_PATH =
  "/v1/network/relationship-views/:viewId" as const;
export const NETWORK_RELATIONSHIP_VIEW_VERSION_PATH =
  "/v1/network/relationship-views/:viewId/versions/:version" as const;
export const NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH =
  "/v1/network/companies/:companyId/relationship-views" as const;
export const NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH =
  "/v1/network/companies/:companyId/relationship-views/:viewId" as const;
export const NETWORK_COMPANY_RELATIONSHIP_VIEW_VERSION_PATH =
  "/v1/network/companies/:companyId/relationship-views/:viewId/versions/:version" as const;
