import {
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  TruthClassSchema,
} from "@capital-q/contracts";
import { z } from "zod";

/**
 * InvestIQ shadow assessment contracts. Package-local on purpose: the method
 * is unapproved, so nothing here is a shared HTTP/Q contract yet. Promote to
 * @capital-q/contracts only with an approved method version (ADR 0068).
 *
 * There is deliberately no numeric score, percentage, weight or composite
 * field anywhere in the output (FDN brief p.7 "Scores should never create
 * false precision"; PADL #142; FSR §4 Finding 3).
 */

export const CORE_DIMENSIONS = [
  "FOUNDER_AND_LEADERSHIP",
  "MARKET_OPPORTUNITY",
  "PRODUCT_AND_TECHNOLOGY",
  "COMMERCIAL_PERFORMANCE",
  "FINANCIAL_HEALTH",
  "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
  "CAPITAL_STRATEGY",
] as const;
export const CoreDimensionSchema = z.enum(CORE_DIMENSIONS);
export type CoreDimension = z.infer<typeof CoreDimensionSchema>;

/** The FDN brief's nine (p.4), kept only as a lens over the Core Seven. */
export const FDN_DIMENSIONS = [
  "BUSINESS_FUNDAMENTALS",
  "COMMERCIAL_STRENGTH",
  "FINANCIAL_READINESS",
  "GOVERNANCE",
  "MANAGEMENT_AND_TEAM",
  "LEGAL_AND_CORPORATE",
  "INVESTMENT_CASE",
  "INVESTOR_FIT",
  "DILIGENCE_READINESS",
] as const;
export const FdnDimensionSchema = z.enum(FDN_DIMENSIONS);
export type FdnDimension = z.infer<typeof FdnDimensionSchema>;

/**
 * What an observation says about merit. RECORDED: the fact is on record
 * but nobody has judged it (most of today's data). INDICATES_WEAKNESS must
 * be affirmative evidence of weakness, never a missing document.
 */
export const ObservationReadingSchema = z.enum([
  "SUPPORTS_STRENGTH",
  "INDICATES_WEAKNESS",
  "RECORDED",
]);

export const ObservationSourceKindSchema = z.enum([
  "PROFILE",
  "CLAIM",
  "DOCUMENT",
  "DECK",
  "DATA_ROOM",
  "RAISE",
  "THIRD_PARTY",
  "PUBLIC_SOURCE",
  "Q_EXTRACTION",
]);

const IsoSchema = z.string().datetime({ offset: true });

export const InvestIQObservationSchema = z
  .object({
    id: z.string().min(1).max(200),
    criterion: z.string().regex(/^[a-z]+\.[a-z_]+$/),
    reading: ObservationReadingSchema,
    /**
     * Rubric anchor 0-4 (investiq/v1), set by a deterministic producer or a
     * human reviewer, never by a model alone. 2 is the stage-appropriate
     * baseline. Must agree with the reading: weakness 0-1, recorded 2,
     * strength 3-4. Absent: derived from the reading.
     */
    anchor: z.number().int().min(0).max(4).optional(),
    statement: z.string().min(1).max(500),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    lifecycleStatus: LifecycleStatusSchema,
    provenance: z
      .object({
        sourceKind: ObservationSourceKindSchema,
        /** Evidence/claim/document id where one exists. */
        sourceRef: z.string().min(1).max(200).nullable(),
        /** Null: when it was observed is unknown. */
        observedAt: IsoSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type InvestIQObservation = z.infer<typeof InvestIQObservationSchema>;

export const InvestIQInputSchema = z
  .object({
    /** Opaque; never a name. */
    companyRef: z.string().min(1).max(200),
    /** Caller-supplied snapshot time; the assessment never reads a clock. */
    asOf: IsoSchema,
    context: z
      .object({
        /** Null: stage unknown. Unknown never grants NOT_APPLICABLE. */
        stageCode: z.string().min(1).max(40).nullable(),
        sectorCodes: z.array(z.string().min(1).max(80)).max(20),
        businessModel: z.string().min(1).max(80).nullable(),
        instrument: z.string().min(1).max(80).nullable(),
      })
      .strict(),
    observations: z.array(InvestIQObservationSchema).max(2000),
  })
  .strict();
export type InvestIQInput = z.infer<typeof InvestIQInputSchema>;

export const CriterionStateSchema = z.enum([
  "NOT_APPLICABLE",
  "UNKNOWN",
  "CONFLICTED",
  "WEAKNESS_EVIDENCED",
  "STRENGTH_INDICATED",
  "RECORDED",
]);
export type CriterionState = z.infer<typeof CriterionStateSchema>;

export const ExclusionReasonSchema = z.enum([
  "SUPERSEDED",
  "TRUTH_UNKNOWN",
  "INFERENCE_WITHOUT_EVIDENCE",
]);

const CountsSchema = z
  .object({
    strengthIndicated: z.number().int().min(0),
    weaknessEvidenced: z.number().int().min(0),
    recorded: z.number().int().min(0),
    conflicted: z.number().int().min(0),
    unknown: z.number().int().min(0),
    notApplicable: z.number().int().min(0),
  })
  .strict();

export const CriterionResultSchema = z
  .object({
    criterion: z.string(),
    label: z.string(),
    state: CriterionStateSchema,
    applicabilityRule: z.string().nullable(),
    observationIds: z.array(z.string()),
    excluded: z.array(
      z.object({ id: z.string(), reason: ExclusionReasonSchema }).strict(),
    ),
    /** Statements that something is explicitly not known. Shown as gaps, never as weakness. */
    knownUnknowns: z.array(z.string()),
    strongestEvidenceStatus: EvidenceStatusSchema.nullable(),
    staleObservations: z.number().int().min(0),
  })
  .strict();

const UNSPECIFIED = z.literal("UNSPECIFIED_PENDING_METHOD_APPROVAL");

export const DimensionResultSchema = z
  .object({
    dimension: CoreDimensionSchema,
    label: z.string(),
    output: z.enum(["BUSINESS_QUALITY", "INVESTMENT_READINESS"]),
    applicability: z.enum(["APPLICABLE", "NOT_APPLICABLE"]),
    criteria: z.array(CriterionResultSchema),
    /** The subscore: an evidence profile, not a number. */
    subscore: z
      .object({
        kind: z.literal("EVIDENCE_PROFILE"),
        counts: CountsSchema,
        applicableCriteria: z.number().int().min(0),
        observedCriteria: z.number().int().min(0),
        highestEvidenceStatus: EvidenceStatusSchema.nullable(),
        hasUnresolvedConflict: z.boolean(),
        hasEvidencedWeakness: z.boolean(),
      })
      .strict(),
    grade: z.null(),
    gradeStatus: UNSPECIFIED,
    confidence: z.object({ level: z.null(), status: UNSPECIFIED }).strict(),
    /** Spec 4.3 (:2812): an applicable dimension with nothing observed cannot be complete. */
    necessaryConditionMet: z.boolean(),
  })
  .strict();
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

const SeparateOutputSchema = z
  .object({
    dimensions: z.array(CoreDimensionSchema),
    headline: z.null(),
    headlineStatus: UNSPECIFIED,
    compositionStatus: z.literal("PROPOSED_ADR_0068"),
  })
  .strict();

export const TraceStepSchema = z
  .object({
    seq: z.number().int().min(1),
    subject: z.string(),
    rule: z.string(),
    provenance: z.string(),
    outcome: z.string(),
  })
  .strict();

export const InvestIQAssessmentSchema = z
  .object({
    method: z
      .object({
        version: z.string().regex(/^[a-z][a-z0-9-]*\/v[0-9]+$/),
        status: z.literal("SHADOW_UNAPPROVED"),
      })
      .strict(),
    companyRef: z.string(),
    asOf: IsoSchema,
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    dimensions: z.array(DimensionResultSchema).length(7),
    businessQuality: SeparateOutputSchema,
    investmentReadiness: SeparateOutputSchema,
    intelligenceConfidence: z
      .object({ level: z.null(), status: UNSPECIFIED })
      .strict(),
    /** Never computed here; named so no consumer reads fit/interest/state from this object. */
    notComputedHere: z.array(
      z.enum([
        "INVESTOR_FIT",
        "INTEREST",
        "MATCH",
        "RELATIONSHIP_STATE",
        "OUTCOME",
      ]),
    ),
    fdnLens: z.array(
      z
        .object({
          fdn: FdnDimensionSchema,
          routedTo: z.enum(["THIS_ASSESSMENT", "DISCOVERY_FIT"]),
          criteria: z.array(
            z
              .object({ criterion: z.string(), state: CriterionStateSchema })
              .strict(),
          ),
        })
        .strict(),
    ),
    finalisation: z
      .object({
        status: z.literal("PROVISIONAL"),
        reasons: z.array(z.string()),
      })
      .strict(),
    trace: z.array(TraceStepSchema),
  })
  .strict();
export type InvestIQAssessment = z.infer<typeof InvestIQAssessmentSchema>;
