import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * CRM import (owner decision 106, 2026-11-18): an investor or a founder
 * brings the pipeline they already keep (a CSV or XLSX export of Affinity,
 * HubSpot, Airtable, a spreadsheet ...). Q reads it and arranges it the way
 * Capital Q arranges its own pipeline: each row matched to the ONE
 * canonical counterpart, its stage history appended to that relationship,
 * notes and next steps kept on the importer's side only.
 *
 * Prepare -> Approve -> Execute: preparing reads and stages, nothing more;
 * applying needs the exact proposal hash the importer approved.
 */

/** Rows read from one file, at most. Larger files are refused, never cut. */
export const PIPELINE_IMPORT_MAX_ROWS = 5000;
/** Columns read from one file, at most. */
export const PIPELINE_IMPORT_MAX_COLUMNS = 64;
/** The file's size, at most (the upload path allows more for other files). */
export const PIPELINE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Rows the preview shows; every ambiguous row is shown in addition. */
export const PIPELINE_IMPORT_PREVIEW_ROWS = 50;

/**
 * Where a sheet's columns can land (research 2026-11-18,
 * docs/specs/crm-import/2026-11-18-crm-import-research.md §3). Reference
 * data, not a database enum.
 */
export const PIPELINE_IMPORT_FIELDS = [
  "counterpartName",
  "website",
  "stage",
  "stageDate",
  "addedOn",
  "lastContactOn",
  "contactName",
  "contactEmail",
  "contactTitle",
  "owner",
  "source",
  "amount",
  "currency",
  "valuation",
  "round",
  "sector",
  "location",
  "priority",
  "notes",
  "nextStep",
  "nextStepDue",
  "passReason",
  "tags",
] as const;
export const PipelineImportFieldSchema = z.enum(PIPELINE_IMPORT_FIELDS);
export type PipelineImportField = z.infer<typeof PipelineImportFieldSchema>;

/**
 * Where a row stands in the importer's own words, read onto Capital Q's
 * pipeline vocabulary. A self-reported reading: it never moves the shared
 * relationship state, which only the two parties' own actions do.
 */
export const PIPELINE_IMPORT_STAGES = [
  "RESEARCH",
  "CONTACTED",
  "MEETING",
  "DILIGENCE",
  "TERM_SHEET",
  "COMMITTED",
  "CLOSED",
  "PASSED",
  "PAUSED",
  "UNKNOWN",
] as const;
export const PipelineImportStageSchema = z.enum(PIPELINE_IMPORT_STAGES);
export type PipelineImportStage = z.infer<typeof PipelineImportStageSchema>;

/** {target field: the sheet's header}. Each header lands in one field at most. */
export const PipelineImportMappingSchema = z
  .partialRecord(PipelineImportFieldSchema, z.string().min(1).max(200))
  .refine((mapping) => mapping.counterpartName !== undefined, {
    message: "The mapping names the column holding the counterpart's name.",
  });
export type PipelineImportMapping = z.infer<typeof PipelineImportMappingSchema>;

export const PIPELINE_IMPORT_MATCH_STATUSES = [
  "MATCHED",
  "AMBIGUOUS",
  "NEW",
  "INVALID",
] as const;
export const PipelineImportMatchStatusSchema = z.enum(
  PIPELINE_IMPORT_MATCH_STATUSES,
);
export type PipelineImportMatchStatus = z.infer<
  typeof PipelineImportMatchStatusSchema
>;

export const PreparePipelineImportRequestSchema = z
  .object({
    /** An uploaded CSV or XLSX of the actor's own organisation. */
    documentId: UuidSchema,
    /**
     * The person's own column mapping, edited on the import screen: the file
     * is read again with it (mapping source PERSON). Absent: Q proposes one.
     */
    mapping: PipelineImportMappingSchema.optional(),
  })
  .strict();
export type PreparePipelineImportRequest = z.infer<
  typeof PreparePipelineImportRequestSchema
>;

export const PipelineImportCountsSchema = z
  .object({
    rows: z.number().int().min(0).max(PIPELINE_IMPORT_MAX_ROWS),
    matched: z.number().int().min(0),
    ambiguous: z.number().int().min(0),
    new: z.number().int().min(0),
    invalid: z.number().int().min(0),
  })
  .strict();
export type PipelineImportCounts = z.infer<typeof PipelineImportCountsSchema>;

export const PipelineImportPreviewRowSchema = z
  .object({
    rowNumber: z.number().int().min(1),
    name: z.string().max(200).nullable(),
    stage: PipelineImportStageSchema.nullable(),
    stageLabel: z.string().max(80).nullable(),
    match: PipelineImportMatchStatusSchema,
    matched: z
      .object({ id: UuidSchema, name: z.string().max(200) })
      .strict()
      .nullable(),
    /** For an ambiguous row: whom it may be. */
    candidates: z
      .array(z.object({ id: UuidSchema, name: z.string().max(200) }).strict())
      .max(5),
  })
  .strict();
export type PipelineImportPreviewRow = z.infer<
  typeof PipelineImportPreviewRowSchema
>;

export const PipelineImportPreviewSchema = z
  .object({
    importId: UuidSchema,
    /** What the approval binds to. */
    proposalHash: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: z.string().min(1).max(255),
    side: z.enum(["INVESTOR", "COMPANY"]),
    mapping: PipelineImportMappingSchema,
    /** Q proposed it, the headers' usual names did, or the person chose it. */
    mappingSource: z.enum(["Q", "HEADERS", "PERSON"]),
    /** Every column of the file, in its order (for the mapping choices). */
    columns: z.array(z.string().max(200)).max(PIPELINE_IMPORT_MAX_COLUMNS),
    unmappedColumns: z.array(z.string().max(200)).max(64),
    counts: PipelineImportCountsSchema,
    rows: z.array(PipelineImportPreviewRowSchema).max(PIPELINE_IMPORT_MAX_ROWS),
    status: z.enum(["PREPARED", "APPLIED"]),
  })
  .strict();
export type PipelineImportPreview = z.infer<typeof PipelineImportPreviewSchema>;

/** The importer's choice for one row; rows not named take the default. */
export const PipelineImportResolutionSchema = z
  .object({
    rowNumber: z.number().int().min(1).max(PIPELINE_IMPORT_MAX_ROWS),
    /** A candidate's id (ambiguous rows only), or keep/skip. */
    choice: z.union([UuidSchema, z.enum(["KEEP_PRIVATE", "SKIP"])]),
  })
  .strict();
export type PipelineImportResolution = z.infer<
  typeof PipelineImportResolutionSchema
>;

export const ApplyPipelineImportRequestSchema = z
  .object({
    proposalHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** What the card showed; refused when it no longer matches the import. */
    counts: PipelineImportCountsSchema,
    resolutions: z
      .array(PipelineImportResolutionSchema)
      .max(PIPELINE_IMPORT_MAX_ROWS)
      .default([]),
  })
  .strict();
export type ApplyPipelineImportRequest = z.infer<
  typeof ApplyPipelineImportRequestSchema
>;

export const PipelineImportResultSchema = z
  .object({
    linked: z.number().int().min(0),
    relationshipsCreated: z.number().int().min(0),
    keptPrivate: z.number().int().min(0),
    skipped: z.number().int().min(0),
    stageEvents: z.number().int().min(0),
    notes: z.number().int().min(0),
    tasks: z.number().int().min(0),
    /**
     * Relationships whose side fields (stage, owner, source, expected
     * cheque, priority) the import set. Absent on imports applied before
     * those fields existed.
     */
    details: z.number().int().min(0).optional(),
  })
  .strict();
export type PipelineImportResult = z.infer<typeof PipelineImportResultSchema>;

/** A relationship an applied import linked, for the result's links. */
export const PipelineImportLinkSchema = z
  .object({
    relationshipId: UuidSchema,
    /** The counterpart: a company (investor import) or investor organisation. */
    counterpartId: UuidSchema,
    name: z.string().max(200),
  })
  .strict();
export type PipelineImportLink = z.infer<typeof PipelineImportLinkSchema>;

/** Links the result carries, at most; the pipeline lists every one. */
export const PIPELINE_IMPORT_LINKS_MAX = 200;

export const PipelineImportAppliedSchema = z
  .object({
    importId: UuidSchema,
    /** True when an earlier approval had already run it. */
    replayed: z.boolean(),
    result: PipelineImportResultSchema,
    relationships: z
      .array(PipelineImportLinkSchema)
      .max(PIPELINE_IMPORT_LINKS_MAX),
  })
  .strict();
export type PipelineImportAppliedDto = z.infer<
  typeof PipelineImportAppliedSchema
>;

/**
 * Decision 106, gap 7: a row the organisation kept private because the
 * counterpart is not on Capital Q. Its own prospect, never a canonical
 * company or investor; read only by the importing organisation.
 */
export const PipelineProspectSchema = z
  .object({
    importId: UuidSchema,
    rowNumber: z.number().int().min(1),
    name: z.string().min(1).max(200),
    website: z.string().max(253).nullable(),
    stage: PipelineImportStageSchema.nullable(),
    stageLabel: z.string().max(80).nullable(),
    priority: z.string().max(300).nullable(),
    source: z.string().max(300).nullable(),
    contactName: z.string().max(300).nullable(),
    /** As the file gave it: an exact decimal, with its currency if named. */
    amount: z.string().max(40).nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    fileName: z.string().min(1).max(255),
    importedAt: UtcTimestampSchema,
  })
  .strict();
export type PipelineProspect = z.infer<typeof PipelineProspectSchema>;

/** Prospects one read returns, the latest row per name. */
export const PIPELINE_PROSPECTS_MAX = 500;

export const PipelineProspectListSchema = z
  .object({
    items: z.array(PipelineProspectSchema).max(PIPELINE_PROSPECTS_MAX),
    visibility: z.literal("organisation_private"),
  })
  .strict();
export type PipelineProspectList = z.infer<typeof PipelineProspectListSchema>;

export const PIPELINE_IMPORTS_PATH = "/v1/network/pipeline-imports" as const;
export const PIPELINE_PROSPECTS_PATH =
  "/v1/network/pipeline-imports/prospects" as const;
export const COMPANY_PIPELINE_PROSPECTS_PATH =
  "/v1/network/companies/:companyId/pipeline-imports/prospects" as const;
export const PIPELINE_IMPORT_APPLY_PATH =
  "/v1/network/pipeline-imports/:importId/apply" as const;
/** A founder's import, under their company (the id is checked, never proof). */
export const COMPANY_PIPELINE_IMPORTS_PATH =
  "/v1/network/companies/:companyId/pipeline-imports" as const;
export const COMPANY_PIPELINE_IMPORT_APPLY_PATH =
  "/v1/network/companies/:companyId/pipeline-imports/:importId/apply" as const;
