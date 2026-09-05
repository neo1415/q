import { z } from "zod";

import {
  createUuidIdSchema,
  DisclosureScopeSchema,
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  MessageSensitivitySchema,
  ReliabilityClassSchema,
  TruthClassSchema,
  UuidSchema,
  type DisclosureScope,
  type EvidenceStatus,
  type LifecycleStatus,
  type MessageSensitivity,
  type ReliabilityClass,
  type TruthClass,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

/**
 * Evidence bounded-context contracts (CQ-EVD-001, doc 13 §19–23, ADR-001).
 *
 *   Source ≠ Document ≠ DocumentVersion ≠ EvidenceItem ≠ Claim
 *   Claim ≠ canonical Company state ≠ Q Knowledge object
 *   Evidence ≠ Verification
 *
 * A Source answers "where did this originate", never "Capital Q believes
 * this". A Document is a logical identity whose bytes live in immutable
 * versions. An Evidence Item is something identified inside a Source. A
 * Claim is an assertion about a canonical subject with its own truth,
 * evidence and lifecycle axes, revised through history and never
 * overwritten. None of it mutates canonical domain state.
 */

// ---------------------------------------------------------------------------
// Identifiers (branded; wire form stays a plain UUID)
// ---------------------------------------------------------------------------

export const EvidenceSourceIdSchema = createUuidIdSchema("EvidenceSourceId");
export type EvidenceSourceId = z.infer<typeof EvidenceSourceIdSchema>;

export const DocumentIdSchema = createUuidIdSchema("DocumentId");
export type DocumentId = z.infer<typeof DocumentIdSchema>;

export const DocumentVersionIdSchema = createUuidIdSchema("DocumentVersionId");
export type DocumentVersionId = z.infer<typeof DocumentVersionIdSchema>;

export const DocumentProcessingRunIdSchema = createUuidIdSchema(
  "DocumentProcessingRunId",
);
export type DocumentProcessingRunId = z.infer<
  typeof DocumentProcessingRunIdSchema
>;

export const ClaimIdSchema = createUuidIdSchema("ClaimId");
export type ClaimId = z.infer<typeof ClaimIdSchema>;

export const ClaimRevisionIdSchema = createUuidIdSchema("ClaimRevisionId");
export type ClaimRevisionId = z.infer<typeof ClaimRevisionIdSchema>;

export const EvidenceItemIdSchema = createUuidIdSchema("EvidenceItemId");
export type EvidenceItemId = z.infer<typeof EvidenceItemIdSchema>;

// ---------------------------------------------------------------------------
// Coded vocabularies (checked strings in the database, never enums)
// ---------------------------------------------------------------------------

/**
 * Canonical subjects evidence can be about. Only subjects with a safe,
 * typed query port are listed; a subject id is resolved through the
 * registry before anything is written and never through dynamic SQL.
 */
export const EVIDENCE_SUBJECT_TYPES = ["COMPANY"] as const;
export const EvidenceSubjectTypeSchema = z.enum(EVIDENCE_SUBJECT_TYPES);
export type EvidenceSubjectType = z.infer<typeof EvidenceSubjectTypeSchema>;

export const EvidenceSubjectRefSchema = z
  .object({ subjectType: EvidenceSubjectTypeSchema, subjectId: UuidSchema })
  .strict();
export type EvidenceSubjectRef = z.infer<typeof EvidenceSubjectRefSchema>;

/** Where information originated. Provider is separate; never a provider-specific type. */
export const EVIDENCE_SOURCE_TYPES = [
  "USER_STATEMENT",
  "DOCUMENT",
  "MEETING",
  "CONVERSATION",
  "PLATFORM_EVENT",
  "INTEGRATION",
  "PUBLIC_WEB",
  "REGULATORY_RECORD",
  "ADMIN_VERIFICATION",
] as const;
export const EvidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

/**
 * Declared document categories for V1: the founder onboarding materials
 * plus the coarse business categories. A declared type is what a person
 * or a trusted workflow said; no classifier has run in this packet.
 */
export const DOCUMENT_TYPES = [
  "UNCLASSIFIED",
  "PITCH_DECK",
  "FINANCIAL_MODEL",
  "MANAGEMENT_ACCOUNTS",
  "COMPANY_PROFILE",
  "FINANCIAL",
  "LEGAL",
  "CORPORATE",
  "GOVERNANCE",
  "PRODUCT",
  "COMMERCIAL",
  "CUSTOMER",
  "OPERATIONAL",
  "OTHER",
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DOCUMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** Version-level pipeline state. CQ-EVD-002/003 drive the transitions. */
export const PROCESSING_STATUSES = [
  "NOT_STARTED",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export const ProcessingStatusSchema = z.enum(PROCESSING_STATUSES);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const MALWARE_SCAN_STATUSES = [
  "PENDING",
  "CLEAN",
  "BLOCKED",
  "ERROR",
] as const;
export const MalwareScanStatusSchema = z.enum(MALWARE_SCAN_STATUSES);
export type MalwareScanStatus = z.infer<typeof MalwareScanStatusSchema>;

export const TEXT_EXTRACTION_STATUSES = [
  "NOT_STARTED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  /** No extractor exists for this format yet. Never "completed" (CQ-EVD-003). */
  "UNSUPPORTED",
] as const;
export const TextExtractionStatusSchema = z.enum(TEXT_EXTRACTION_STATUSES);
export type TextExtractionStatus = z.infer<typeof TextExtractionStatusSchema>;

export const PROCESSING_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  /**
   * Policy refused the work: an infected object, an unavailable scanner
   * under a fail-closed policy, or a format with no extractor. Terminal and
   * never retried, and deliberately distinct from FAILED, which means the
   * attempt broke and may be worth another (CQ-EVD-003).
   */
  "BLOCKED",
] as const;
export const ProcessingRunStatusSchema = z.enum(PROCESSING_RUN_STATUSES);
export type ProcessingRunStatus = z.infer<typeof ProcessingRunStatusSchema>;

/** Who asserted a claim. The id is interpreted per type; it grants nothing. */
export const CLAIM_ASSERTER_TYPES = [
  "USER",
  "ORGANISATION",
  "SOURCE",
  "SYSTEM",
] as const;
export const ClaimAsserterTypeSchema = z.enum(CLAIM_ASSERTER_TYPES);
export type ClaimAsserterType = z.infer<typeof ClaimAsserterTypeSchema>;

export const CLAIM_EVIDENCE_RELATIONSHIPS = [
  "SUPPORTS",
  "CONTRADICTS",
  "QUALIFIES",
  "SUPERSEDES",
] as const;
export const ClaimEvidenceRelationshipSchema = z.enum(
  CLAIM_EVIDENCE_RELATIONSHIPS,
);
export type ClaimEvidenceRelationship = z.infer<
  typeof ClaimEvidenceRelationshipSchema
>;

/** Change categories carried by claim events. Never the statement itself. */
export const CLAIM_CHANGE_KINDS = [
  "CREATED",
  "REVISED",
  "EVIDENCE_LINKED",
] as const;
export const ClaimChangeKindSchema = z.enum(CLAIM_CHANGE_KINDS);
export type ClaimChangeKind = z.infer<typeof ClaimChangeKindSchema>;

// ---------------------------------------------------------------------------
// Bounded scalar shapes
// ---------------------------------------------------------------------------

const CODE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** `revenue.arr`, `team.headcount`: a stable dotted lower_snake key. */
export const ClaimKeySchema = z.string().regex(CODE).max(128);
export const ClaimTypeSchema = z.string().regex(CODE).max(64);
export const EvidenceTypeSchema = z.string().regex(CODE).max(64);

export const ClaimStatementSchema = z.string().trim().min(1).max(2000);
export const EvidenceSummarySchema = z.string().trim().min(1).max(2000);
export const DocumentTitleSchema = z.string().trim().min(1).max(200);
export const SourceTitleSchema = z.string().trim().min(1).max(200);

/** Lowercase SHA-256 hex of the bytes. Identity for duplicate detection only. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Storage identity. The key is a server-generated random path segment set,
 * never a client-supplied path and never an authorization token.
 */
export const StorageBucketSchema = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);
export const StorageKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_.-]{0,254}$/)
  .refine((key) => !key.includes(".."), "storage keys never traverse");

export const MimeTypeSchema = z
  .string()
  .regex(/^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/i)
  .max(129);
export const OriginalFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      !/[\\/]/.test(name) &&
      [...name].every((ch) => ch.charCodeAt(0) >= 32) &&
      name !== "." &&
      name !== "..",
    "a filename is a name, not a path",
  );

/** Version numbers are ordinal within one logical document. */
export const VersionNumberSchema = z.number().int().min(1);
export const RevisionNumberSchema = z.number().int().min(1);

/** `evidence-v1`: a pipeline identity, unique per document version. */
export const PipelineVersionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*-v[0-9]+$/)
  .max(64);

/** Extension point only; no production weighting methodology exists. */
export const ClaimEvidenceWeightSchema = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Bounded JSON: structured values and provenance metadata
// ---------------------------------------------------------------------------

const JsonScalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
type JsonValue =
  | z.infer<typeof JsonScalar>
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonScalar,
    z.array(JsonValue).max(64),
    z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), JsonValue),
  ]),
);

function boundedObject(maxBytes: number) {
  return z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), JsonValue)
    .refine(
      (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes,
      `at most ${String(maxBytes)} bytes`,
    );
}

/** A structured reading of a statement (e.g. `{ amount: "2000000", currency: "USD" }`). */
export const StructuredValueSchema = boundedObject(8_192);
export type StructuredValue = z.infer<typeof StructuredValueSchema>;

const FORBIDDEN_METADATA_KEY =
  /(password|secret|token|apikey|api_key|authorization|cookie|prompt|credential)/i;

/**
 * Sparse provenance metadata about a source (page counts, external ids,
 * content hashes). Never document text, conversations, prompts, secrets or
 * raw responses; keys carrying such names are refused outright.
 */
export const SourceMetadataSchema = boundedObject(4_096).refine(
  (value) =>
    Object.keys(value).every((key) => !FORBIDDEN_METADATA_KEY.test(key)),
  "provenance metadata never carries secrets, prompts or credentials",
);
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

export const ProcessingRunMetadataSchema = boundedObject(4_096);
export type ProcessingRunMetadata = z.infer<typeof ProcessingRunMetadataSchema>;

// ---------------------------------------------------------------------------
// Evidence locators: traceability back into a source, never permission
// ---------------------------------------------------------------------------

/** A place inside an immutable document version. Knowing it grants nothing. */
export const DocumentLocatorSchema = z
  .object({
    kind: z.literal("document"),
    documentVersionId: UuidSchema,
    page: z.number().int().min(1).optional(),
    paragraph: z.number().int().min(1).optional(),
    sheet: z.string().trim().min(1).max(64).optional(),
    cell: z
      .string()
      .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/)
      .optional(),
    excerptHash: Sha256Schema.optional(),
  })
  .strict();
export type DocumentLocator = z.infer<typeof DocumentLocatorSchema>;

/** A time range inside a meeting recording or transcript (future CQ-MEET). */
export const MeetingLocatorSchema = z
  .object({
    kind: z.literal("meeting"),
    meetingId: UuidSchema,
    startSeconds: z.number().int().min(0),
    endSeconds: z.number().int().min(0),
  })
  .strict()
  .refine((value) => value.endSeconds >= value.startSeconds, {
    message: "endSeconds must not precede startSeconds",
    path: ["endSeconds"],
  });
export type MeetingLocator = z.infer<typeof MeetingLocatorSchema>;

/** A direct statement with no finer location than the source itself. */
export const StatementLocatorSchema = z
  .object({ kind: z.literal("statement") })
  .strict();
export type StatementLocator = z.infer<typeof StatementLocatorSchema>;

export const EvidenceLocatorSchema = z.discriminatedUnion("kind", [
  DocumentLocatorSchema,
  MeetingLocatorSchema,
  StatementLocatorSchema,
]);
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EvidenceSource = {
  readonly id: EvidenceSourceId;
  readonly tenantId: TenantId;
  readonly sourceType: EvidenceSourceType;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly provider: string | null;
  readonly externalReference: string | null;
  readonly title: string | null;
  /** Provenance only. Never fetched by this context. */
  readonly sourceUrl: string | null;
  readonly createdByUserId: UserId | null;
  readonly retrievedAt: UtcTimestamp | null;
  readonly publishedAt: UtcTimestamp | null;
  readonly reliabilityClass: ReliabilityClass | null;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: MessageSensitivity;
  readonly metadata: SourceMetadata;
  readonly createdAt: UtcTimestamp;
};

export type Document = {
  readonly id: DocumentId;
  readonly tenantId: TenantId;
  readonly companyId: string | null;
  readonly ownerOrganisationId: OrganisationId;
  readonly documentType: DocumentType;
  readonly title: string;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: MessageSensitivity;
  readonly currentVersionId: DocumentVersionId | null;
  readonly status: DocumentStatus;
  readonly createdByUserId: UserId;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  /** Optimistic concurrency on the logical document, not on its bytes. */
  readonly version: number;
};

export type DocumentVersion = {
  readonly id: DocumentVersionId;
  readonly tenantId: TenantId;
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedByUserId: UserId;
  readonly uploadedAt: UtcTimestamp;
  readonly supersedesVersionId: DocumentVersionId | null;
  readonly processingStatus: ProcessingStatus;
  readonly malwareScanStatus: MalwareScanStatus;
  readonly textExtractionStatus: TextExtractionStatus;
};

export type DocumentProcessingRun = {
  readonly id: DocumentProcessingRunId;
  readonly documentVersionId: DocumentVersionId;
  readonly pipelineVersion: string;
  readonly status: ProcessingRunStatus;
  readonly startedAt: UtcTimestamp | null;
  readonly completedAt: UtcTimestamp | null;
  readonly errorCode: string | null;
  readonly extractorVersion: string | null;
  readonly classifierVersion: string | null;
  readonly embeddingModelId: string | null;
  /** Exact decimal string; never a float. */
  readonly costUsd: string;
  readonly metadata: ProcessingRunMetadata;
  readonly createdAt: UtcTimestamp;
};

export type Claim = {
  readonly id: ClaimId;
  readonly tenantId: TenantId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly claimType: string;
  readonly claimKey: string;
  readonly statement: string;
  readonly structuredValue: StructuredValue | null;
  readonly assertedByType: ClaimAsserterType;
  readonly assertedById: string;
  readonly assertedAt: UtcTimestamp;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: MessageSensitivity;
  readonly currentRevisionId: ClaimRevisionId;
  readonly currentRevisionNumber: number;
  readonly createdAt: UtcTimestamp;
};

export type ClaimRevision = {
  readonly id: ClaimRevisionId;
  readonly tenantId: TenantId;
  readonly claimId: ClaimId;
  readonly revisionNumber: number;
  readonly statement: string;
  readonly structuredValue: StructuredValue | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly changeReason: string | null;
  readonly changedByType: ClaimAsserterType;
  readonly changedById: string;
  readonly sourceId: EvidenceSourceId | null;
  readonly createdAt: UtcTimestamp;
};

export type EvidenceItem = {
  readonly id: EvidenceItemId;
  readonly tenantId: TenantId;
  readonly sourceId: EvidenceSourceId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly evidenceType: string;
  readonly summary: string;
  readonly structuredValue: StructuredValue | null;
  readonly locator: EvidenceLocator;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly reliabilityClass: ReliabilityClass | null;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: MessageSensitivity;
  readonly createdByUserId: UserId | null;
  readonly createdAt: UtcTimestamp;
};

export type ClaimEvidenceLink = {
  readonly tenantId: TenantId;
  readonly claimId: ClaimId;
  readonly evidenceItemId: EvidenceItemId;
  readonly relationship: ClaimEvidenceRelationship;
  readonly weight: string | null;
  readonly createdByUserId: UserId | null;
  readonly createdAt: UtcTimestamp;
};

// Re-export the shared scales so consumers of this package see one surface.
export {
  DisclosureScopeSchema,
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  MessageSensitivitySchema as SensitivityClassSchema,
  ReliabilityClassSchema,
  TruthClassSchema,
};
export type {
  DisclosureScope,
  EvidenceStatus,
  LifecycleStatus,
  MessageSensitivity as SensitivityClass,
  ReliabilityClass,
  TruthClass,
};

export * from "./upload.js";

// Structured extraction contracts (CQ-EVD-003).
export * from "./extraction.js";
