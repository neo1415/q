import { z } from "zod";

import {
  createUuidIdSchema,
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type UtcTimestamp,
} from "@capital-q/contracts";
import {
  CellRangeSchema,
  type DocumentExtractionId,
  type DocumentId,
  type DocumentVersionId,
  type EvidenceSourceId,
  type EvidenceSubjectType,
} from "@capital-q/evidence/contracts";
import type { OrganisationId, TenantId } from "@capital-q/security";

/**
 * Chunk contracts (CQ-RAG-001; doc 13 §41.1, doc 14 §11-§14).
 *
 *   source ≠ document ≠ document version ≠ extraction ≠ chunk
 *   chunk ≠ evidence item ≠ claim ≠ Q knowledge ≠ canonical company fact
 *   embedding ≠ chunk;   parsed text ≠ verified truth
 *
 * A chunk is a derived, searchable representation of governed source
 * content. Every chunk can say where it came from (source, document
 * version, extraction, page/slide/sheet/range, parser and chunker version),
 * who owns it, what visibility and sensitivity it inherited, and whether it
 * is still active. It never carries authority: a locator grants no access.
 */

export const ChunkSetIdSchema = createUuidIdSchema("ChunkSetId");
export type ChunkSetId = z.infer<typeof ChunkSetIdSchema>;

export const ChunkIdSchema = createUuidIdSchema("ChunkId");
export type ChunkId = z.infer<typeof ChunkIdSchema>;

/**
 * The chunking strategy family version. Bumped when any strategy changes
 * boundaries, rendering or hashing: a bump derives a new chunk set and
 * never rewrites an old one.
 *
 * History:
 *   q-chunking-v1  CQ-RAG-001: slide / narrative / spreadsheet strategies,
 *                  parent-child for long sections, 10% sentence overlap.
 */
export const CHUNKING_VERSION = "q-chunking-v1" as const;

export const ChunkingVersionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*-v[0-9]+$/)
  .max(64);

export const CHUNKING_STRATEGIES = [
  "slide",
  "narrative",
  "spreadsheet",
  /** More than one strategy applied to one document (a deck with notes, a report with sheets). */
  "mixed",
] as const;
export const ChunkingStrategySchema = z.enum(CHUNKING_STRATEGIES);
export type ChunkingStrategy = z.infer<typeof ChunkingStrategySchema>;

export const CHUNK_KINDS = [
  "slide",
  "section",
  "passage",
  "table",
  "list",
  "spreadsheet_range",
] as const;
export const ChunkKindSchema = z.enum(CHUNK_KINDS);
export type ChunkKind = z.infer<typeof ChunkKindSchema>;

export const CHUNK_ROLES = ["LEAF", "PARENT"] as const;
export const ChunkRoleSchema = z.enum(CHUNK_ROLES);
export type ChunkRole = z.infer<typeof ChunkRoleSchema>;

export const CHUNK_SET_STATUSES = ["ACTIVE", "SUPERSEDED", "REVOKED"] as const;
export const ChunkSetStatusSchema = z.enum(CHUNK_SET_STATUSES);
export type ChunkSetStatus = z.infer<typeof ChunkSetStatusSchema>;

export const CHUNK_SET_STATUS_REASONS = [
  "NOT_CURRENT_VERSION",
  "DOCUMENT_ARCHIVED",
  "NEWER_CHUNKING_VERSION",
  "NEWER_DOCUMENT_VERSION",
  "NEWER_EXTRACTION",
  "SOURCE_REVOKED",
  "DOCUMENT_REVOKED",
] as const;
export const ChunkSetStatusReasonSchema = z.enum(CHUNK_SET_STATUS_REASONS);
export type ChunkSetStatusReason = z.infer<typeof ChunkSetStatusReasonSchema>;

/**
 * Size policy (doc 14 §12), in provider-neutral estimated tokens. Structure
 * wins over these numbers: a slide or a table is never split to hit a
 * target, and overlap exists only between consecutive prose passages.
 */
export const CHUNK_LIMITS = {
  /** A leaf that a search would return on its own. */
  targetLeafTokens: 500,
  maxLeafTokens: 800,
  /** A coherent parent block returned around a matching leaf. */
  maxParentTokens: 1_200,
  overlapRatio: 0.1,
  /** Hard bound on one chunk's text; matches the table constraint. */
  maxContentCharacters: 32_000,
  maxChunksPerSet: 50_000,
  maxHeadingPath: 6,
  maxHeadingCharacters: 200,
} as const;

/**
 * Where a chunk's text came from, aggregated from its blocks. Provenance,
 * never authority: knowing "page 12" or "Sheet1!A1:D20" grants nothing.
 */
export const ChunkLocatorSchema = z
  .object({
    pageStart: z.number().int().min(1).optional(),
    pageEnd: z.number().int().min(1).optional(),
    slide: z.number().int().min(1).optional(),
    slideTitle: z.string().max(500).optional(),
    headingPath: z
      .array(z.string().max(CHUNK_LIMITS.maxHeadingCharacters))
      .max(CHUNK_LIMITS.maxHeadingPath)
      .optional(),
    sectionStart: z.number().int().min(0).optional(),
    sectionEnd: z.number().int().min(0).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
    sheet: z.string().max(255).optional(),
    range: CellRangeSchema.optional(),
    rowStart: z.number().int().min(1).optional(),
    rowEnd: z.number().int().min(1).optional(),
  })
  .strict();
export type ChunkLocator = z.infer<typeof ChunkLocatorSchema>;

/** One chunk as the planner produces it, before it has an id or an owner. */
export const PlannedChunkSchema = z
  .object({
    index: z.number().int().min(0),
    role: ChunkRoleSchema,
    /** Index of the parent within the same plan; leaves under no parent are null. */
    parentIndex: z.number().int().min(0).nullable(),
    kind: ChunkKindSchema,
    content: z.string().min(1).max(CHUNK_LIMITS.maxContentCharacters),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    tokenEstimate: z.number().int().min(0),
    blockIndexStart: z.number().int().min(0),
    blockIndexEnd: z.number().int().min(0),
    locator: ChunkLocatorSchema,
    instructionRiskSignals: z.number().int().min(0),
  })
  .strict()
  .refine((chunk) => chunk.blockIndexEnd >= chunk.blockIndexStart, {
    message: "a chunk's block range is ordered",
    path: ["blockIndexEnd"],
  })
  .refine((chunk) => chunk.role === "LEAF" || chunk.parentIndex === null, {
    message: "a parent has no parent",
    path: ["parentIndex"],
  });
export type PlannedChunk = z.infer<typeof PlannedChunkSchema>;

export const ChunkPlanSchema = z
  .object({
    chunkingVersion: ChunkingVersionSchema,
    strategy: ChunkingStrategySchema,
    chunks: z.array(PlannedChunkSchema).max(CHUNK_LIMITS.maxChunksPerSet),
    tokenEstimate: z.number().int().min(0),
    /** True when the chunk bound stopped planning early; never silent. */
    truncated: z.boolean(),
  })
  .strict();
export type ChunkPlan = z.infer<typeof ChunkPlanSchema>;

export type ChunkSet = {
  readonly id: ChunkSetId;
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId;
  readonly sourceId: EvidenceSourceId | null;
  readonly documentId: DocumentId;
  readonly documentVersionId: DocumentVersionId;
  readonly extractionId: DocumentExtractionId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly chunkingStrategy: ChunkingStrategy;
  readonly chunkingVersion: string;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  readonly status: ChunkSetStatus;
  readonly statusReason: ChunkSetStatusReason | null;
  readonly invalidatedAt: UtcTimestamp | null;
  readonly chunkCount: number;
  readonly tokenEstimate: number;
  readonly createdAt: UtcTimestamp;
};

export type NewChunkSet = Omit<
  ChunkSet,
  "id" | "createdAt" | "invalidatedAt" | "status" | "statusReason"
> & {
  readonly status: ChunkSetStatus;
  readonly statusReason: ChunkSetStatusReason | null;
};

export type Chunk = {
  readonly id: ChunkId;
  readonly tenantId: TenantId;
  readonly chunkSetId: ChunkSetId;
  readonly documentVersionId: DocumentVersionId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly parentChunkId: ChunkId | null;
  readonly chunkIndex: number;
  readonly role: ChunkRole;
  readonly kind: ChunkKind;
  readonly content: string;
  readonly contentSha256: string;
  readonly tokenEstimate: number;
  readonly blockIndexStart: number;
  readonly blockIndexEnd: number;
  readonly locator: ChunkLocator;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  readonly instructionRiskSignals: number;
  readonly status: ChunkSetStatus;
  readonly invalidatedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
};

export type NewChunk = Omit<
  Chunk,
  "id" | "createdAt" | "invalidatedAt" | "status"
> & {
  readonly status: ChunkSetStatus;
};

export const VisibilityScopeSchema = MarketplaceVisibilitySchema;
export const SensitivityClassSchema = MessageSensitivitySchema;
