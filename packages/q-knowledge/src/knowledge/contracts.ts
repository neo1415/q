import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  QConfidenceLevelSchema,
  UtcTimestampSchema,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type QConfidenceLevel,
  type UtcTimestamp,
} from "@capital-q/contracts";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
  type EvidenceStatus,
  type TruthClass,
} from "@capital-q/evidence/contracts";
import type { TenantId } from "@capital-q/security";

import type { MeasurementBasis } from "./compatibility.js";
import type { FreshnessAssessment } from "./freshness.js";

/**
 * Q Knowledge Objects (CQ-KNW-002).
 *
 * The difference between "this document says ARR is $2.4m" and "Capital Q
 * currently understands ARR to be approximately $2.4m, on this evidence,
 * with this confidence".
 *
 *   Claim ≠ Knowledge Object ≠ canonical company state ≠ Data Room ≠ audit
 *   evidence status ≠ confidence ≠ truth class;  Q knows ≠ a user may know
 *   document-supported ≠ verified;  historical ≠ false;  unknown ≠ negative
 *
 * A model may propose. Nothing here lets it decide.
 */

export const KNOWLEDGE_TYPES = ["fact", "observation", "inference"] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export const KnowledgeTypeSchema = z.enum(KNOWLEDGE_TYPES);

/**
 * The lifecycle. CANDIDATE covers both proposed and held: a candidate
 * waiting on a person is a candidate with a reason, not a ninth state.
 * CQ-KNW-003 owns DISPUTED resolution and the temporal states.
 */
export const KNOWLEDGE_STATUSES = [
  "CANDIDATE",
  "ACTIVE",
  "REJECTED",
  "SUPERSEDED",
  "DISPUTED",
  "STALE",
  "REVOKED",
  "ARCHIVED",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export const KnowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);

export const KNOWLEDGE_SOURCE_ENVIRONMENTS = [
  "PLATFORM",
  "DOCUMENT",
  "CONVERSATION",
  "MEETING",
  "INTEGRATION",
  "PUBLIC",
] as const;
export type KnowledgeSourceEnvironment =
  (typeof KNOWLEDGE_SOURCE_ENVIRONMENTS)[number];

export const KnowledgeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
  .max(128);

export const KnowledgeSubjectRefSchema = z
  .object({
    subjectType: z.literal("COMPANY"),
    subjectId: z.string().uuid(),
  })
  .strict();
export type KnowledgeSubjectRef = z.infer<typeof KnowledgeSubjectRefSchema>;

const StructuredValueSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 8_192,
    "at most 8192 bytes",
  );

/**
 * What may be PROPOSED, by a model, a worker or a person.
 *
 * Absent by construction, because a field that does not exist cannot be
 * supplied: tenant, visibility scope, sensitivity class, status, confidence
 * class, evidence status, reliability, revision number, object id, or any
 * canonical company field. Every one is resolved server-side.
 *
 * `truthClassProposal` exists but cannot say VERIFIED — the enum has no such
 * member, so a candidate asking to be verified is asking for a value this
 * type cannot hold. Deterministic policy may still lower it.
 */
export const KnowledgeCandidateSchema = z
  .object({
    subject: KnowledgeSubjectRefSchema,
    knowledgeType: KnowledgeTypeSchema,
    knowledgeKey: KnowledgeKeySchema,
    statement: z.string().trim().min(1).max(2_000),
    structuredValue: StructuredValueSchema.nullable(),
    /** VERIFIED is unreachable: it is not a member of this enum. */
    truthClassProposal: z.enum([
      "USER_CLAIM",
      "ESTIMATE",
      "Q_INFERENCE",
      "UNKNOWN",
    ]),
    /** Claims this understanding rests on. Validated against the tenant's rows. */
    supportingClaimIds: z.array(z.string().uuid()).max(32),
    /** Evidence items it rests on. At least one, or there is nothing behind it. */
    supportingEvidenceItemIds: z.array(z.string().uuid()).max(32),
    /** Registered sources. Distinctness here is what multi-source means. */
    supportingSourceIds: z.array(z.string().uuid()).max(32),
    validFrom: UtcTimestampSchema.nullable(),
    validTo: UtcTimestampSchema.nullable(),
    /**
     * How the metric is defined, when the subject measures it more than one
     * way (gross, net_of_churn). Two understandings of one key under
     * different definitions are an accepted difference, not a conflict.
     */
    definitionQualifier: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .nullable()
      .default(null),
    /** ACTUAL, FORECAST or ESTIMATE. A forecast is not a competing measurement. */
    measurementBasis: z
      .enum(["ACTUAL", "FORECAST", "ESTIMATE", "UNSPECIFIED"])
      .default("ACTUAL"),
    /**
     * The caller stating this restates a period already recorded, rather
     * than describing a later one.
     *
     * It is a request, never a decision. The gate still checks that the two
     * periods actually match before treating anything as a correction, so a
     * candidate cannot supersede an inconvenient figure by asserting that it
     * corrects it.
     */
    correctsEarlier: z.boolean().default(false),
    /** Existing knowledge this one is derived from. Bounded relationships. */
    lineage: z
      .array(
        z
          .object({
            parentObjectId: z.string().uuid(),
            relationship: z.enum([
              "derived_from",
              "depends_on",
              "supports",
              "reassesses",
              "supersedes",
            ]),
          })
          .strict(),
      )
      .max(16),
    /** Why this is being proposed. A code, not prose a document could write. */
    reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  })
  .strict()
  .refine(
    (candidate) =>
      candidate.validFrom === null ||
      candidate.validTo === null ||
      candidate.validFrom <= candidate.validTo,
    { message: "validFrom must not follow validTo", path: ["validTo"] },
  )
  .refine(
    (candidate) =>
      candidate.knowledgeType !== "inference" ||
      candidate.truthClassProposal === "Q_INFERENCE",
    {
      message: "an inference is a Q inference",
      path: ["truthClassProposal"],
    },
  );
export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;
/**
 * What a caller supplies. The measurement context and the correction flag
 * have defaults, so an existing caller that never heard of them keeps
 * working and gets the conservative reading: an actual measurement, not a
 * correction.
 */
export type KnowledgeCandidateInput = z.input<typeof KnowledgeCandidateSchema>;

/** A stored understanding, as the application reads it back. */
export type KnowledgeObject = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly subject: KnowledgeSubjectRef;
  readonly knowledgeType: KnowledgeType;
  readonly knowledgeKey: string;
  readonly statement: string;
  readonly structuredValue: Record<string, unknown> | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly confidenceClass: QConfidenceLevel;
  readonly reliabilityClass: string | null;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly recordedAt: UtcTimestamp;
  readonly sourceEnvironment: KnowledgeSourceEnvironment;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  /** How the metric is defined, when a subject measures it more than one way. */
  readonly definitionQualifier: string | null;
  readonly measurementBasis: MeasurementBasis;
  /** When this was last checked against its source. Freshness, never permission. */
  readonly lastVerifiedAt: UtcTimestamp | null;
  readonly status: KnowledgeStatus;
  readonly holdReason: string | null;
  readonly reassessmentRequiredAt: UtcTimestamp | null;
  readonly reassessmentReason: string | null;
  readonly currentRevisionNumber: number;
  readonly createdAt: UtcTimestamp;
};

export type KnowledgeRevision = {
  readonly id: string;
  readonly knowledgeObjectId: string;
  readonly revisionNumber: number;
  readonly statement: string;
  readonly structuredValue: Record<string, unknown> | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly confidenceClass: QConfidenceLevel;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly changeReason: string;
  readonly createdByType: "USER" | "SYSTEM" | "Q";
  readonly createdById: string | null;
  readonly createdAt: UtcTimestamp;
};

// ---------------------------------------------------------------------------
// What the Write Gate decides
// ---------------------------------------------------------------------------

/**
 * The verdict. ACCEPTED means an ACTIVE object exists; HELD means a
 * CANDIDATE was recorded and is waiting on a person; REJECTED means nothing
 * was written at all; REVISED means an existing understanding gained a
 * revision.
 */
export const KNOWLEDGE_WRITE_OUTCOMES = [
  "ACCEPTED",
  "REVISED",
  "HELD",
  "DUPLICATE",
  /** Recorded beside an existing understanding that measures the metric differently. */
  "ACCEPTED_DIFFERENCE",
  /** A restatement of a period already recorded; the earlier reading is superseded, never deleted. */
  "CORRECTED",
  "REJECTED",
] as const;
export type KnowledgeWriteOutcome = (typeof KNOWLEDGE_WRITE_OUTCOMES)[number];

/**
 * Bounded reason codes. They reach telemetry, tests and a future reviewer's
 * queue — never a person's screen, and none of them names a value, a
 * document or a tenant.
 */
export const KNOWLEDGE_WRITE_REASONS = [
  "RECORDED",
  "UNCHANGED",
  "VALUE_CHANGED",
  "SUPPORT_CHANGED",
  /** Q concluded it rather than reading it; a person decides if it stands. */
  "INFERENCE_NEEDS_CONFIRMATION",
  /** A current understanding on this key disagrees. Neither is chosen. */
  "CONFLICTS_WITH_ACTIVE",
  /** The same metric, defined differently. Both stand. */
  "DIFFERENT_DEFINITION",
  /** A projection beside a measurement, or the reverse. */
  "DIFFERENT_BASIS",
  /** A different stretch of time. A series, not a disagreement. */
  "DIFFERENT_PERIOD",
  /** The same period restated. The earlier reading is kept as superseded. */
  "CORRECTS_EARLIER_PERIOD",
  /** Same question, no basis on which to compare the answers. */
  "NOT_COMPARABLE",
  /** Nothing stands behind it. No source, no entity evidence. */
  "NO_SUPPORTING_EVIDENCE",
  /** A claim, evidence item or source id that is not this tenant's, or not this subject's. */
  "PROVENANCE_NOT_FOUND",
  /** The evidence would have to be read more widely than it is classified. */
  "SCOPE_NOT_PERMITTED",
  /** The candidate is malformed. */
  "CANDIDATE_INVALID",
] as const;
export type KnowledgeWriteReason = (typeof KNOWLEDGE_WRITE_REASONS)[number];

export type KnowledgeWriteResult = {
  readonly outcome: KnowledgeWriteOutcome;
  readonly reason: KnowledgeWriteReason;
  readonly knowledgeKey: string;
  readonly objectId: string | null;
  readonly status: KnowledgeStatus | null;
  readonly truthClass: TruthClass | null;
  readonly evidenceStatus: EvidenceStatus | null;
  readonly confidenceClass: QConfidenceLevel | null;
  readonly visibilityScope: MarketplaceVisibility | null;
  readonly sensitivityClass: MessageSensitivity | null;
  readonly revisionNumber: number | null;
  /** How many distinct registered sources stand behind it. */
  readonly supportingSourceCount: number;
  /** The recorded disagreement this candidate joined or opened, if any. */
  readonly contradictionSetId: string | null;
  /** Why the comparison decided as it did. Never a private value. */
  readonly comparison: string | null;
};

export const KnowledgeWriteResultSchema = z
  .object({
    outcome: z.enum(KNOWLEDGE_WRITE_OUTCOMES),
    reason: z.enum(KNOWLEDGE_WRITE_REASONS),
    knowledgeKey: KnowledgeKeySchema,
    objectId: z.string().uuid().nullable(),
    status: KnowledgeStatusSchema.nullable(),
    truthClass: TruthClassSchema.nullable(),
    evidenceStatus: EvidenceStatusSchema.nullable(),
    confidenceClass: QConfidenceLevelSchema.nullable(),
    visibilityScope: MarketplaceVisibilitySchema.nullable(),
    sensitivityClass: MessageSensitivitySchema.nullable(),
    revisionNumber: z.number().int().min(1).nullable(),
    supportingSourceCount: z.number().int().min(0),
    contradictionSetId: z.string().uuid().nullable(),
    comparison: z.string().nullable(),
  })
  .strict();

/** A read, as the permission-aware query service returns it. */
export type AuthorisedKnowledge = {
  readonly object: KnowledgeObject;
  /** Public-safe provenance: counts and ids, never a storage path or a URL. */
  readonly evidence: readonly {
    readonly evidenceItemId: string;
    readonly relationship:
      "SUPPORTS" | "CONTRADICTS" | "QUALIFIES" | "SUPERSEDES";
  }[];
  readonly sourceIds: readonly string[];
  /**
   * Whether this has outlived its useful life. Stale is not false, and it is
   * never a permission: an old founder-private figure is founder-private.
   */
  readonly freshness: FreshnessAssessment;
  /**
   * Whether another settled understanding of the same period disagrees. True
   * means the answer must not be given alone — the other side travels with
   * it (§55).
   */
  readonly disputed: boolean;
};
