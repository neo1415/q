import { z } from "zod";

import {
  EvidenceStatusSchema,
  QConfidenceLevelSchema,
  TruthClassSchema,
} from "@capital-q/contracts";

import {
  ClarifyingQuestionSchema,
  LIST_MAX,
  ModelStatementSchema,
  TaskFrameSchema,
  TEXT_MAX,
} from "./common.js";

/**
 * FOUNDER_ONBOARDING_EXTRACTION (CQ-Q-006 §29; PADL Decision 12).
 *
 * Interpret founder-provided narrative and material into CANDIDATE
 * structured facts. Assessment, not coaching: the prompt runs in
 * ASSESSMENT mode and produces candidates for the onboarding review
 * gate — nothing here writes a company. The fields mirror what founder
 * onboarding v1 collects (identity, stage, description, team, signal,
 * raise) so a candidate can be offered as a suggestion for a known step.
 */

/** The onboarding facts a candidate may target. Names, not step ids. */
export const FOUNDER_FACT_KEYS = [
  "company_name",
  "website",
  "country",
  "stage",
  "description",
  "categories",
  "founder_role",
  "founder_count",
  "full_time",
  "team_size",
  "functions",
  "signal",
  "pilots",
  "revenue_status",
  "customers",
  "growth",
  "raising",
  "currency",
  "target_amount",
  "instrument",
  "timeframe",
  "use_of_funds",
] as const;
export const FounderFactKeySchema = z.enum(FOUNDER_FACT_KEYS);
export type FounderFactKey = z.infer<typeof FounderFactKeySchema>;

export const FounderExtractionVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The founder's narrative and/or supplied material. UNTRUSTED. */
    founderNarrative: z.string().trim().min(1).max(60_000),
    /** Facts already known from authorised context, so they are not re-asked. UNTRUSTED data. */
    knownFacts: z
      .array(
        z
          .object({ key: FounderFactKeySchema, value: z.string().max(1_000) })
          .strict(),
      )
      .max(FOUNDER_FACT_KEYS.length),
  })
  .strict();
export type FounderExtractionVariables = z.infer<
  typeof FounderExtractionVariablesSchema
>;

export const FOUNDER_EXTRACTION_UNTRUSTED = [
  "founderNarrative",
  "knownFacts",
] as const;

export const FounderCandidateFactSchema = z
  .object({
    key: FounderFactKeySchema,
    /** The candidate value, as the founder put it where possible. */
    value: z.string().trim().min(1).max(1_000),
    /** Verbatim words the value rests on, when any. */
    quote: z.string().max(600).nullable(),
    /** USER_CLAIM for stated facts; Q_INFERENCE when inferred; never VERIFIED. */
    truthClass: TruthClassSchema.exclude(["VERIFIED"]),
    evidenceStatus: EvidenceStatusSchema.exclude([
      "DOCUMENT_SUPPORTED",
      "MULTI_SOURCE_SUPPORTED",
      "EXTERNALLY_VERIFIED",
      "PLATFORM_VERIFIED",
    ]),
    confidence: QConfidenceLevelSchema,
    explicit: z.boolean(),
  })
  .strict();
export type FounderCandidateFact = z.infer<typeof FounderCandidateFactSchema>;

export const FounderExtractionResultSchema = z
  .object({
    candidates: z
      .array(FounderCandidateFactSchema)
      .max(FOUNDER_FACT_KEYS.length),
    /** Facts the narrative does not establish and onboarding still needs. */
    missing: z.array(FounderFactKeySchema).max(FOUNDER_FACT_KEYS.length),
    /** Statements that are opinion or aspiration, kept apart from facts. */
    opinions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** Internal inconsistencies in the narrative. */
    contradictions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** At most a few high-value questions; asked later, never coaching. */
    clarifyingQuestions: z.array(ClarifyingQuestionSchema).max(3).default([]),
    /** Brief neutral summary of what the narrative says, for the reviewer. */
    summary: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict();
export type FounderExtractionResult = z.infer<
  typeof FounderExtractionResultSchema
>;

export const FOUNDER_EXTRACTION_SCHEMA_NAME = "FounderExtractionResult";
export const FOUNDER_EXTRACTION_SCHEMA_VERSION = 1;
