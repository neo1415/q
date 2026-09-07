import { z } from "zod";

import {
  MessageSensitivitySchema,
  UtcTimestampSchema,
  type MessageSensitivity,
} from "@capital-q/contracts";

import {
  ClaimIdSchema,
  ClaimKeySchema,
  EvidenceItemIdSchema,
  EvidenceLocatorSchema,
  EvidenceSourceIdSchema,
  EvidenceSubjectRefSchema,
  type ClaimId,
  type EvidenceItemId,
  type EvidenceLocator,
  type EvidenceSourceId,
  type EvidenceSubjectRef,
  type TruthClass,
} from "../contracts/index.js";

/**
 * Claim interpretation (CQ-KNW-001).
 *
 * The boundary between "a source said something" and "Capital Q recorded a
 * claim". A proposal is untrusted input whatever produced it — a model, a
 * parser, a person's own words — and it becomes a Claim only by passing
 * deterministic validation and then going through the Evidence application
 * services that CQ-EVD-001 already owns.
 *
 *   Source ≠ EvidenceItem ≠ Claim ≠ Q Knowledge ≠ canonical company state
 *   document-supported ≠ verified;  retrieved ≠ accepted;  unknown ≠ zero
 *
 * Nothing here persists anything. Nothing here calls a model.
 */

/** The extraction generation. Every proposal is attributable to one. */
export const CLAIM_EXTRACTION_PIPELINE_VERSION = "claim-extraction-v1" as const;

/**
 * How a passage relates to an assertion, as the proposer may state it.
 *
 * There is deliberately no VERIFIED member and no truth class here at all.
 * A proposer names the relationship it observed; deterministic policy maps
 * that, together with the source's own type, onto the canonical truth
 * class. A document that asks to be marked verified is asking for a value
 * this type cannot hold.
 */
export const CLAIM_ASSERTION_KINDS = [
  "SOURCE_ASSERTION",
  "SOURCE_ESTIMATE",
  "MODEL_INFERENCE",
] as const;
export type ClaimAssertionKind = (typeof CLAIM_ASSERTION_KINDS)[number];
export const ClaimAssertionKindSchema = z.enum(CLAIM_ASSERTION_KINDS);

/**
 * A typed value a source stated. Money keeps its own currency: there is no
 * default, no conversion and no inference, because "2.4m" is not dollars
 * and an annual run-rate is not revenue.
 */
export const ProposedValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MONEY"),
      amount: z.number().finite(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  z
    .object({ kind: z.literal("COUNT"), value: z.number().int().min(0) })
    .strict(),
  z
    .object({ kind: z.literal("PERCENTAGE"), value: z.number().finite() })
    .strict(),
  z.object({ kind: z.literal("DATE"), value: z.iso.date() }).strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      value: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type ProposedValue = z.infer<typeof ProposedValueSchema>;

/**
 * One proposed claim, after the proposer has spoken and before anything is
 * trusted.
 *
 * Absent by construction, because a field that does not exist cannot be
 * supplied by a model or by a document: tenant, visibility scope,
 * sensitivity class, truth class, evidence status, lifecycle status,
 * asserting user, confidence, evidence weight, claim id, evidence item id.
 * Every one of those is derived server-side from the source and the actor.
 */
export const ClaimProposalSchema = z
  .object({
    claimKey: ClaimKeySchema,
    /** Q's normalised restatement; never a replacement for the excerpt. */
    statement: z.string().trim().min(1).max(500),
    value: ProposedValueSchema.nullable(),
    assertionKind: ClaimAssertionKindSchema,
    /** The source's own words. Checked against the passage, verbatim. */
    excerpt: z.string().trim().min(1).max(500),
    /**
     * Narrowing inside the passage's own locator. A proposer may say "page
     * 8"; it may not say "a different document", and the service rebuilds
     * the locator from the trusted passage rather than from this.
     */
    locatorHint: z
      .object({
        page: z.number().int().min(1).max(10_000).optional(),
        slide: z.number().int().min(1).max(10_000).optional(),
        sheet: z.string().trim().min(1).max(64).optional(),
        cell: z
          .string()
          .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/)
          .optional(),
      })
      .strict()
      .optional(),
    /** The period the source attached. Null means it attached none. */
    asOf: z.iso.date().nullable(),
  })
  .strict();
export type ClaimProposal = z.infer<typeof ClaimProposalSchema>;

/**
 * The authorised passage an extraction runs over.
 *
 * Assembled by the caller from material the Context Firewall permitted. The
 * source id, document version and locator are the SERVER's, resolved before
 * the proposer sees anything; a proposer never supplies them.
 */
export const ExtractionPassageSchema = z
  .object({
    sourceId: EvidenceSourceIdSchema,
    subject: EvidenceSubjectRefSchema,
    locator: EvidenceLocatorSchema,
    /** The text handed to the proposer. Untrusted content. */
    text: z.string().trim().min(1).max(8_000),
    /** Trusted, human-readable, for the prompt frame. Never a storage path. */
    description: z.string().max(400),
  })
  .strict();
export type ExtractionPassage = z.infer<typeof ExtractionPassageSchema>;

/**
 * Where a proposal came from. Extraction provenance, never truth authority:
 * knowing which model read a passage says nothing about whether the passage
 * is right.
 */
export type ExtractionProvenance = {
  readonly pipelineVersion: string;
  readonly proposerKind: "DETERMINISTIC" | "MODEL";
  readonly promptVersionId: string | null;
  readonly providerCode: string | null;
  readonly modelCode: string | null;
};

export type ClaimProposalBatch = {
  readonly proposals: readonly ClaimProposal[];
  /** Permitted claim keys the passage does not establish. Never a zero. */
  readonly absent: readonly string[];
  readonly provenance: ExtractionProvenance;
};

/** What happened to one proposal. Every outcome keeps its reason. */
export const CLAIM_INTERPRETATION_OUTCOMES = [
  /** A new claim and its supporting evidence were recorded. */
  "ACCEPTED",
  /** The same claim and evidence already existed; nothing was written twice. */
  "DUPLICATE",
  /** Evidence recorded and linked; the claim was left for a person to settle. */
  "HELD",
  /** Nothing was written. */
  "REJECTED",
] as const;
export type ClaimInterpretationOutcome =
  (typeof CLAIM_INTERPRETATION_OUTCOMES)[number];

/**
 * Why. Bounded codes: they reach telemetry and tests, never a person's
 * screen, and none of them names a document, a value or a tenant.
 */
export const CLAIM_INTERPRETATION_REASONS = [
  "RECORDED",
  "ALREADY_RECORDED",
  /** An inference is not a source assertion; a person decides if it stands. */
  "INFERENCE_NEEDS_CONFIRMATION",
  /** A current claim on this key disagrees. Both are kept; neither wins. */
  "CONFLICTS_WITH_CURRENT_CLAIM",
  /** The passage does not contain the words the proposal quoted. */
  "EXCERPT_NOT_IN_PASSAGE",
  /** The claim key is outside the set this extraction was permitted. */
  "CLAIM_KEY_NOT_PERMITTED",
  /** A money value arrived without a currency, or a value made no sense. */
  "VALUE_NOT_INTERPRETABLE",
  /** The proposal named a subject, source or version that is not the passage's. */
  "PROVENANCE_MISMATCH",
] as const;
export type ClaimInterpretationReason =
  (typeof CLAIM_INTERPRETATION_REASONS)[number];

export type ClaimInterpretationRecord = {
  readonly claimKey: string;
  readonly outcome: ClaimInterpretationOutcome;
  readonly reason: ClaimInterpretationReason;
  readonly truthClass: TruthClass | null;
  readonly claimId: ClaimId | null;
  readonly evidenceItemId: EvidenceItemId | null;
  /** SUPPORTS for agreement, CONTRADICTS when a current claim disagrees. */
  readonly relationship: "SUPPORTS" | "CONTRADICTS" | null;
  readonly sensitivityClass: MessageSensitivity | null;
};

export type ClaimInterpretationResult = {
  readonly sourceId: EvidenceSourceId;
  readonly subject: EvidenceSubjectRef;
  readonly locator: EvidenceLocator;
  readonly provenance: ExtractionProvenance;
  readonly records: readonly ClaimInterpretationRecord[];
  /** Permitted keys this passage did not establish. Reported, never stored as zero. */
  readonly absent: readonly string[];
  /**
   * Set when no proposer could run and nothing was recorded. A blocked
   * extraction is not an empty one: the difference is whether Capital Q
   * looked, and the caller must be able to tell.
   */
  readonly blocked: "PROVIDER_INELIGIBLE" | "PROVIDER_UNAVAILABLE" | null;
  readonly counts: {
    readonly proposed: number;
    readonly accepted: number;
    readonly duplicate: number;
    readonly held: number;
    readonly rejected: number;
  };
};

export const ClaimInterpretationRecordSchema = z
  .object({
    claimKey: ClaimKeySchema,
    outcome: z.enum(CLAIM_INTERPRETATION_OUTCOMES),
    reason: z.enum(CLAIM_INTERPRETATION_REASONS),
    truthClass: z
      .enum(["VERIFIED", "USER_CLAIM", "ESTIMATE", "Q_INFERENCE", "UNKNOWN"])
      .nullable(),
    claimId: ClaimIdSchema.nullable(),
    evidenceItemId: EvidenceItemIdSchema.nullable(),
    relationship: z.enum(["SUPPORTS", "CONTRADICTS"]).nullable(),
    sensitivityClass: MessageSensitivitySchema.nullable(),
  })
  .strict();

/**
 * The claim keys this packet permits, with the value each must carry.
 *
 * A bounded list rather than free text: a claim key is how two assertions
 * are recognised as the same fact, so an invented key silently creates a
 * second fact that nothing will ever reconcile. `financial.arr` and
 * `capital.raise_target` are both money and both often "$2m" — the key,
 * not the number, is what keeps them apart.
 */
export const PERMITTED_CLAIM_KEYS: Readonly<
  Record<
    string,
    {
      readonly claimType: string;
      readonly value: ProposedValue["kind"] | "ANY";
    }
  >
> = {
  "financial.arr": { claimType: "financial", value: "MONEY" },
  "financial.mrr": { claimType: "financial", value: "MONEY" },
  "financial.revenue": { claimType: "financial", value: "MONEY" },
  "financial.gross_margin": { claimType: "financial", value: "PERCENTAGE" },
  "financial.burn_rate": { claimType: "financial", value: "MONEY" },
  "traction.customer_count": { claimType: "traction", value: "COUNT" },
  "traction.churn_rate": { claimType: "traction", value: "PERCENTAGE" },
  "team.employee_count": { claimType: "team", value: "COUNT" },
  "capital.raise_target": { claimType: "capital", value: "MONEY" },
  "market.target_market": { claimType: "market", value: "TEXT" },
  "market.size": { claimType: "market", value: "MONEY" },
  "compliance.certification": { claimType: "compliance", value: "TEXT" },
};

export type ClaimInterpretationRequest = {
  readonly passage: ExtractionPassage;
  /** Defaults to every permitted key; narrowed by the caller for a task. */
  readonly claimKeys?: readonly string[] | undefined;
  readonly correlationId: string;
  readonly now?: Date | undefined;
};

export const ExtractionValiditySchema = z
  .object({
    validFrom: UtcTimestampSchema.nullable(),
    validTo: UtcTimestampSchema.nullable(),
  })
  .strict();
