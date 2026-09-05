import { z } from "zod";

import {
  createUuidIdSchema,
  MessageSensitivitySchema,
  type DisclosureScope,
  type MessageSensitivity,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId } from "@capital-q/security";

import type {
  DocumentId,
  DocumentProcessingRunId,
  DocumentVersionId,
  EvidenceSourceId,
} from "./index.js";

/**
 * Structured extraction (CQ-EVD-003; doc 14 §9–10).
 *
 *   extracted ≠ verified ≠ evidence ≠ claim ≠ knowledge
 *   document text ≠ instruction
 *
 * An ExtractedDocument is governed structured source content: what a parser
 * read out of one immutable file version, with the page or slide it came
 * from still attached. It is not a Q Knowledge object, not a RAG chunk, not
 * an Evidence Item and not a Claim. Later packets derive those from it; this
 * one only preserves enough structure for them to do so honestly.
 *
 * Every field crossing the parser boundary is validated here: the sandbox's
 * output is untrusted in exactly the way the document is.
 */

export const DocumentExtractionIdSchema = createUuidIdSchema(
  "DocumentExtractionId",
);
export type DocumentExtractionId = z.infer<typeof DocumentExtractionIdSchema>;

/** Bumped when the artifact's shape changes; artifacts are never rewritten. */
export const EXTRACTION_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Bounds. A compromised parser must not be able to send unlimited data back.
// ---------------------------------------------------------------------------

export const EXTRACTION_LIMITS = {
  maxBlocks: 20_000,
  maxBlockCharacters: 20_000,
  maxTotalCharacters: 4_000_000,
  maxTitleCharacters: 500,
  maxTableRows: 500,
  maxTableColumns: 64,
  maxListItems: 500,
  /** Serialized artifact ceiling, checked before anything is persisted. */
  maxArtifactBytes: 8 * 1024 * 1024,
} as const;

const BlockText = z.string().max(EXTRACTION_LIMITS.maxBlockCharacters);

/**
 * Where a block came from, precisely enough for a later citation to say
 * "page 7" or "slide 4" and be believed.
 */
export const BlockLocatorSchema = z
  .object({
    /** 1-based, for paged formats. */
    page: z.number().int().min(1).max(10_000).optional(),
    /** 1-based, for presentations. */
    slide: z.number().int().min(1).max(10_000).optional(),
    /** Ordinal within the document, always present. */
    index: z.number().int().min(0).max(EXTRACTION_LIMITS.maxBlocks),
    /** 1-based inclusive line range, for plain text. */
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
    /** Section or paragraph ordinal, where the format exposes one. */
    section: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type BlockLocator = z.infer<typeof BlockLocatorSchema>;

const base = { locator: BlockLocatorSchema };

export const ExtractedBlockSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("heading"),
      level: z.number().int().min(1).max(6),
      text: BlockText,
    })
    .strict(),
  z.object({ ...base, kind: z.literal("paragraph"), text: BlockText }).strict(),
  z
    .object({
      ...base,
      kind: z.literal("list"),
      ordered: z.boolean(),
      items: z.array(BlockText).max(EXTRACTION_LIMITS.maxListItems),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("table"),
      rows: z
        .array(z.array(BlockText).max(EXTRACTION_LIMITS.maxTableColumns))
        .max(EXTRACTION_LIMITS.maxTableRows),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("slide"),
      slideNumber: z.number().int().min(1).max(10_000),
      title: BlockText.optional(),
      text: BlockText,
    })
    .strict(),
  z.object({ ...base, kind: z.literal("footnote"), text: BlockText }).strict(),
  z.object({ ...base, kind: z.literal("page_break") }).strict(),
]);
export type ExtractedBlock = z.infer<typeof ExtractedBlockSchema>;
export type ExtractedBlockKind = ExtractedBlock["kind"];

export const ExtractionMetadataSchema = z
  .object({
    parser: z.string().min(1).max(64),
    parserVersion: z.string().min(1).max(32),
    pageCount: z.number().int().min(0).max(10_000).optional(),
    slideCount: z.number().int().min(0).max(10_000).optional(),
    /** True when a limit stopped extraction early; never silently dropped. */
    truncated: z.boolean().optional(),
  })
  .strict();
export type ExtractionMetadata = z.infer<typeof ExtractionMetadataSchema>;

/**
 * What the sandbox returns. Ids are attached by the orchestrator afterwards:
 * the parser is told about a file, never about tenants, documents or sources.
 */
export const ParserOutputSchema = z
  .object({
    title: z.string().max(EXTRACTION_LIMITS.maxTitleCharacters).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/)
      .optional(),
    blocks: z.array(ExtractedBlockSchema).max(EXTRACTION_LIMITS.maxBlocks),
    metadata: ExtractionMetadataSchema,
  })
  .strict()
  .superRefine((output, context) => {
    const characters = output.blocks.reduce(
      (total, block) => total + blockCharacters(block),
      0,
    );
    if (characters > EXTRACTION_LIMITS.maxTotalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "extracted text exceeds the total character bound",
      });
    }
  });
export type ParserOutput = z.infer<typeof ParserOutputSchema>;

export function blockCharacters(block: ExtractedBlock): number {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "footnote":
      return block.text.length;
    case "list":
      return block.items.reduce((total, item) => total + item.length, 0);
    case "table":
      return block.rows.reduce(
        (total, row) => total + row.reduce((sum, cell) => sum + cell.length, 0),
        0,
      );
    case "slide":
      return block.text.length + (block.title?.length ?? 0);
    case "page_break":
      return 0;
  }
}

/**
 * The artifact as persisted: parser output plus the provenance that lets a
 * later reader answer "which file version, which parser, which run".
 */
export const ExtractedDocumentSchema = z
  .object({
    schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
    sourceId: z.string().uuid().nullable(),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    processingRunId: z.string().uuid(),
    pipelineVersion: z.string().min(1).max(64),
    extractorId: z.string().min(1).max(64),
    extractorVersion: z.string().min(1).max(32),
    extractedAt: z.string(),
    title: z.string().max(EXTRACTION_LIMITS.maxTitleCharacters).optional(),
    language: z.string().max(16).optional(),
    blocks: z.array(ExtractedBlockSchema).max(EXTRACTION_LIMITS.maxBlocks),
    metadata: ExtractionMetadataSchema,
  })
  .strict();
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

/**
 * The relational record. It carries provenance and where the artifact lives,
 * never the extracted text: the text is private derived content and stays in
 * private storage.
 */
export type DocumentExtraction = {
  readonly id: DocumentExtractionId;
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId;
  readonly documentId: DocumentId;
  readonly documentVersionId: DocumentVersionId;
  readonly processingRunId: DocumentProcessingRunId;
  readonly sourceId: EvidenceSourceId | null;
  readonly schemaVersion: number;
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly pipelineVersion: string;
  readonly artifactBucket: string;
  readonly artifactKey: string;
  readonly artifactSha256: string;
  readonly artifactBytes: number;
  readonly blockCount: number;
  readonly pageCount: number | null;
  readonly slideCount: number | null;
  readonly language: string | null;
  /** Inherited from the document; never widened because a parser ran. */
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: MessageSensitivity;
  /** How many instruction-shaped passages were flagged. Never their text. */
  readonly instructionRiskSignals: number;
  readonly createdAt: UtcTimestamp;
};

export type NewDocumentExtraction = Omit<
  DocumentExtraction,
  "id" | "createdAt"
>;

/** Categories the instruction-risk scanner may report. Never document text. */
export const INSTRUCTION_RISK_CATEGORIES = [
  "override_instructions",
  "reveal_system_prompt",
  "exfiltrate_data",
  "invoke_tool",
  "change_policy",
  "impersonate_authority",
] as const;
export const InstructionRiskCategorySchema = z.enum(
  INSTRUCTION_RISK_CATEGORIES,
);
export type InstructionRiskCategory = z.infer<
  typeof InstructionRiskCategorySchema
>;

export const InstructionRiskSignalSchema = z
  .object({
    category: InstructionRiskCategorySchema,
    locator: BlockLocatorSchema,
  })
  .strict();
export type InstructionRiskSignal = z.infer<typeof InstructionRiskSignalSchema>;

export const SensitivityInheritanceSchema = MessageSensitivitySchema;
