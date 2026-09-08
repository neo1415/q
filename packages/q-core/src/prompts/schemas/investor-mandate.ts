import { z } from "zod";

import { QConfidenceLevelSchema } from "@capital-q/contracts";

import {
  ClarifyingQuestionSchema,
  LIST_MAX,
  ModelStatementSchema,
  TaskFrameSchema,
  TEXT_MAX,
} from "./common.js";

/**
 * INVESTOR_MANDATE_SYNTHESIS (CQ-Q-006 §30). Turn authorised investor
 * narrative into CANDIDATE declared-mandate and preference information.
 *
 *   Declared Mandate ≠ Observed Behaviour ≠ Q Inference ≠ GateQ Rules
 *
 * The output keeps the four apart by construction: what the investor
 * DECLARED is one list, what Q INFERS is another, and observed behaviour
 * supplied as context can only ever land in the inference list with its
 * basis stated. Nothing here broadens a mandate: a candidate is offered to
 * the investor's onboarding review, never written.
 */

/** The mandate dimensions investor onboarding v1 collects. */
export const MANDATE_DIMENSIONS = [
  "stages",
  "cheque_min",
  "cheque_typical",
  "cheque_max",
  "currency",
  "investment_role",
  "geography",
  "sectors",
  "sectors_avoid",
  "business_models",
  "customer_types",
  "capital_intensity",
  "regulatory_appetite",
  "revenue_state",
  "founder_preferences",
  "green_flags",
  "custom_criteria",
  "hard_exclusions",
  "discovery_mode",
  "inbound_preference",
] as const;
export const MandateDimensionSchema = z.enum(MANDATE_DIMENSIONS);
export type MandateDimension = z.infer<typeof MandateDimensionSchema>;

export const InvestorMandateVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the investor said about what they invest in. UNTRUSTED. */
    investorNarrative: z.string().trim().min(1).max(60_000),
    /** Authorised observations of past behaviour, if any, as data. UNTRUSTED. */
    observedBehaviour: z.array(z.string().max(1_000)).max(LIST_MAX),
    /** Dimensions already declared, so they are not re-asked. UNTRUSTED data. */
    alreadyDeclared: z
      .array(
        z
          .object({
            dimension: MandateDimensionSchema,
            value: z.string().max(1_000),
          })
          .strict(),
      )
      .max(MANDATE_DIMENSIONS.length),
  })
  .strict();
export type InvestorMandateVariables = z.infer<
  typeof InvestorMandateVariablesSchema
>;

export const INVESTOR_MANDATE_UNTRUSTED = [
  "investorNarrative",
  "observedBehaviour",
  "alreadyDeclared",
] as const;

export const DeclaredMandateCandidateSchema = z
  .object({
    dimension: MandateDimensionSchema,
    value: z.string().trim().min(1).max(1_000),
    quote: z.string().max(600).nullable(),
    /** Hard exclusion when the investor said "never"; otherwise a preference. */
    strength: z.enum(["HARD", "STRONG", "PREFERENCE"]),
    confidence: QConfidenceLevelSchema,
  })
  .strict();

export const InferredPreferenceSchema = z
  .object({
    dimension: MandateDimensionSchema,
    value: z.string().trim().min(1).max(1_000),
    /** Why Q thinks so: which words or observations. Never presented as declared. */
    basis: z.string().trim().min(1).max(600),
    confidence: QConfidenceLevelSchema,
  })
  .strict();

export const InvestorMandateSynthesisResultSchema = z
  .object({
    /** What the investor actually declared. */
    declared: z
      .array(DeclaredMandateCandidateSchema)
      .max(MANDATE_DIMENSIONS.length * 2),
    /** What Q infers, kept separate and labelled; may contradict `declared`. */
    inferred: z.array(InferredPreferenceSchema).max(LIST_MAX).default([]),
    /** Where behaviour or inference disagrees with the declaration, stated, not resolved. */
    tensions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    missing: z.array(MandateDimensionSchema).max(MANDATE_DIMENSIONS.length),
    clarifyingQuestions: z.array(ClarifyingQuestionSchema).max(3).default([]),
    summary: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict();
export type InvestorMandateSynthesisResult = z.infer<
  typeof InvestorMandateSynthesisResultSchema
>;

export const INVESTOR_MANDATE_SCHEMA_NAME = "InvestorMandateSynthesisResult";
export const INVESTOR_MANDATE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// v2 (CQ-Q-022 §18-§20, §33-§36, §66)
// ---------------------------------------------------------------------------

/**
 * How firmly the investor expressed something.
 *
 * v1 had HARD | STRONG | PREFERENCE and therefore could not say AVOID —
 * which made the packet's central distinction unrepresentable. A soft
 * negative ("I'd rather avoid hardware") and an exclusion ("never show me
 * hardware") mean different things to a candidate's eligibility, and a
 * scale that cannot tell them apart will eventually collapse them.
 *
 * EXCLUSION_CLAIMED is deliberately named for what it is: the model's
 * reading that the investor asked for a hard exclusion. It is a claim about
 * wording, never a confirmation, and the mapper downstream refuses to turn
 * it into HARD_EXCLUSION without a person (§20).
 */
export const MANDATE_STRENGTHS = [
  "EXCLUSION_CLAIMED",
  "STRONG",
  "PREFERENCE",
  "AVOID",
] as const;
export const MandateStrengthSchema = z.enum(MANDATE_STRENGTHS);
export type MandateStrength = z.infer<typeof MandateStrengthSchema>;

export const DeclaredMandateCandidateV2Schema = z
  .object({
    dimension: MandateDimensionSchema,
    value: z.string().trim().min(1).max(1_000),
    quote: z.string().max(600).nullable(),
    strength: MandateStrengthSchema,
    confidence: QConfidenceLevelSchema,
  })
  .strict();
export type DeclaredMandateCandidateV2 = z.infer<
  typeof DeclaredMandateCandidateV2Schema
>;

/**
 * A phrase the investor used for a sector or a market, before any mapping.
 *
 * Plain words on purpose. Capital Q's own taxonomy service decides whether
 * "payments infrastructure" is a canonical node; a model that could emit
 * taxonomy ids could invent one, and an invented id would silently become a
 * matching criterion (§14, §41).
 */
export const MandateTaxonomyPhraseSchema = z
  .object({
    phrase: z.string().trim().min(1).max(120),
    strength: MandateStrengthSchema,
  })
  .strict();

/**
 * Something the wording genuinely leaves open (§33-§35).
 *
 * The two readings are recorded and the question that separates them is
 * asked. "I mostly invest in Africa" is not resolved into an exclusion, and
 * "early stage" is not resolved into a stage range: inventing precision the
 * investor did not state is how a mandate quietly stops describing them.
 */
export const MANDATE_AMBIGUITY_KINDS = [
  /** Preference, or a hard exclusion? The one that changes eligibility. */
  "SCOPE_OR_EXCLUSION",
  /** A range that may be typical or absolute. */
  "TYPICAL_OR_LIMIT",
  /** A phrase that maps to more than one canonical value. */
  "IMPRECISE_VALUE",
] as const;
export const MandateAmbiguityKindSchema = z.enum(MANDATE_AMBIGUITY_KINDS);

export const MandateAmbiguitySchema = z
  .object({
    dimension: MandateDimensionSchema,
    kind: MandateAmbiguityKindSchema,
    /** The investor's own words that are open to reading. */
    quote: z.string().max(600).nullable(),
    /** The neutral question that would settle it. Never leading. */
    question: ModelStatementSchema,
  })
  .strict();

/**
 * Wording the model judged to be about a protected or irrelevant personal
 * characteristic, reported so the server can refuse it in the open rather
 * than silently dropping it (§16, §36).
 *
 * Nothing here is ever encoded as a constraint. The dimension allowlist
 * makes that structurally impossible; this exists so a person can be told
 * plainly that Capital Q will not screen on it.
 */
export const MandateRefusedCriterionSchema = z
  .object({
    quote: z.string().max(600),
    reason: ModelStatementSchema,
  })
  .strict();

export const InvestorMandateSynthesisV2ResultSchema = z
  .object({
    declared: z
      .array(DeclaredMandateCandidateV2Schema)
      .max(MANDATE_DIMENSIONS.length * 2),
    taxonomyPhrases: z.array(MandateTaxonomyPhraseSchema).max(16).default([]),
    inferred: z.array(InferredPreferenceSchema).max(LIST_MAX).default([]),
    tensions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    ambiguities: z.array(MandateAmbiguitySchema).max(8).default([]),
    refusedCriteria: z.array(MandateRefusedCriterionSchema).max(8).default([]),
    missing: z.array(MandateDimensionSchema).max(MANDATE_DIMENSIONS.length),
    summary: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict();
export type InvestorMandateSynthesisV2Result = z.infer<
  typeof InvestorMandateSynthesisV2ResultSchema
>;

export const INVESTOR_MANDATE_V2_SCHEMA_NAME = "InvestorMandateSynthesisResult";
export const INVESTOR_MANDATE_V2_SCHEMA_VERSION = 2;
