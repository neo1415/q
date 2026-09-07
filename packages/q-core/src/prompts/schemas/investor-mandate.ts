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
