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

// ---------------------------------------------------------------------------
// v2 (CQ-Q-021 §39-§41)
// ---------------------------------------------------------------------------

/**
 * One passage of authorised source material, as the prompt sees it.
 *
 * `ref` is an opaque per-render label — `S1`, `S2` — and the only thing a
 * model may cite. The map from label to document, version and locator never
 * leaves the server, so a candidate cannot claim to come from a slide that
 * was never supplied, and a model that invents `S9` cites nothing (§21).
 */
export const FounderSourcePassageSchema = z
  .object({
    ref: z.string().regex(/^S[0-9]{1,3}$/),
    /** Coarse description a person could recognise: "pitch deck, slide 6". */
    label: z.string().min(1).max(200),
    text: z.string().trim().min(1).max(8_000),
  })
  .strict();
export type FounderSourcePassage = z.infer<typeof FounderSourcePassageSchema>;

export const FounderExtractionV2VariablesSchema =
  FounderExtractionVariablesSchema.extend({
    /**
     * Passages from the founder's own uploaded documents, already authorised
     * and already filtered by the Context Firewall. UNTRUSTED data.
     */
    sourcePassages: z.array(FounderSourcePassageSchema).max(60).default([]),
    /**
     * The onboarding facts still unanswered, so the model proposes questions
     * about what is actually missing rather than about what it finds
     * interesting. TRUSTED — the server computed it.
     */
    unansweredKeys: z
      .array(FounderFactKeySchema)
      .max(FOUNDER_FACT_KEYS.length)
      .default([]),
    /**
     * A plain description of the business's shape, so a SaaS metric is not
     * asked of a company that has no subscriptions (§26). TRUSTED.
     */
    businessShape: z.string().max(400).default(""),
  }).strict();
export type FounderExtractionV2Variables = z.infer<
  typeof FounderExtractionV2VariablesSchema
>;

export const FOUNDER_EXTRACTION_V2_UNTRUSTED = [
  "founderNarrative",
  "knownFacts",
  "sourcePassages",
] as const;

/** A candidate fact, with the passages it rests on. */
export const FounderCandidateFactV2Schema = FounderCandidateFactSchema.extend({
  /** Labels of the supplied passages supporting this. Empty when the founder said it. */
  citations: z
    .array(z.string().regex(/^S[0-9]{1,3}$/))
    .max(4)
    .default([]),
}).strict();
export type FounderCandidateFactV2 = z.infer<
  typeof FounderCandidateFactV2Schema
>;

/**
 * A taxonomy candidate in the founder's own terms (§22).
 *
 * Free text on purpose: the model proposes a phrase, and Capital Q's own
 * deterministic taxonomy service decides whether it maps to a canonical
 * node. A model that could emit taxonomy ids could invent one.
 */
export const FounderTaxonomyCandidateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    citations: z
      .array(z.string().regex(/^S[0-9]{1,3}$/))
      .max(4)
      .default([]),
  })
  .strict();

/**
 * Two supplied passages that disagree about the same thing (§29, §64).
 *
 * A candidate only: whether this is a real contradiction is settled by the
 * knowledge layer's own comparison, which knows about periods, definitions
 * and measurement bases. Nothing here resolves anything.
 */
export const FounderConflictCandidateSchema = z
  .object({
    key: FounderFactKeySchema,
    /** What each side says, in its own words. Never merged, never averaged. */
    readings: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(300),
            citations: z
              .array(z.string().regex(/^S[0-9]{1,3}$/))
              .max(4)
              .default([]),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    /** The question that would settle it, asked neutrally. */
    question: ModelStatementSchema,
  })
  .strict();

/** A proposed next question. The planner decides whether it is asked (§41). */
export const FounderProposedQuestionSchema = z
  .object({
    key: FounderFactKeySchema,
    question: ModelStatementSchema,
    why: z.string().max(300),
  })
  .strict();

export const FounderExtractionV2ResultSchema = z
  .object({
    candidates: z
      .array(FounderCandidateFactV2Schema)
      .max(FOUNDER_FACT_KEYS.length),
    taxonomyCandidates: z
      .array(FounderTaxonomyCandidateSchema)
      .max(8)
      .default([]),
    missing: z.array(FounderFactKeySchema).max(FOUNDER_FACT_KEYS.length),
    /** Facts stated in a way that could mean two things: a period, a unit, a basis. */
    ambiguous: z
      .array(
        z
          .object({ key: FounderFactKeySchema, question: ModelStatementSchema })
          .strict(),
      )
      .max(LIST_MAX)
      .default([]),
    conflicts: z.array(FounderConflictCandidateSchema).max(8).default([]),
    proposedQuestions: z
      .array(FounderProposedQuestionSchema)
      .max(6)
      .default([]),
    opinions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    summary: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict();
export type FounderExtractionV2Result = z.infer<
  typeof FounderExtractionV2ResultSchema
>;

export const FOUNDER_EXTRACTION_V2_SCHEMA_NAME = "FounderExtractionResult";
export const FOUNDER_EXTRACTION_V2_SCHEMA_VERSION = 2;
