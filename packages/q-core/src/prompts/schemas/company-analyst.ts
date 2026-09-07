import { z } from "zod";

import {
  QCapabilitySchema,
  QConfidenceLevelSchema,
} from "@capital-q/contracts";

import {
  AuthorisedFactsSchema,
  ClarifyingQuestionSchema,
  ConversationTurnsSchema,
  LIST_MAX,
  ModelFindingSchema,
  ModelStatementSchema,
  TaskFrameSchema,
  TEXT_MAX,
} from "./common.js";
import {
  CompanyDimensionCoverageSchema,
  CompanyIntelligenceFindingSchema,
  CompanyMaterialChangeSchema,
} from "./company-intelligence.js";

/**
 * COMPANY_ANALYST (CQ-Q-006 §31): analyse supplied authorised company
 * context as an institutional investment analyst, and answer the person.
 *
 * Variables: what the person asked (untrusted), the authorised facts the
 * runtime assembled (untrusted data, each carrying its truth class), the
 * prior turns (untrusted), and the trusted frame. No score, no ranking,
 * no InvestIQ result: those come from authorised services or not at all.
 */
export const CompanyAnalystVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    capability: QCapabilitySchema,
    /** The person's current message. UNTRUSTED. */
    userMessage: z.string().trim().min(1).max(TEXT_MAX),
    /** Earlier turns of this conversation, oldest first. UNTRUSTED. */
    conversation: ConversationTurnsSchema,
    /** Authorised facts about the subject(s), with truth classes. UNTRUSTED data. */
    authorisedFacts: AuthorisedFactsSchema,
    /** Plain description of the subject(s), trusted, e.g. "the person's own company". */
    subjectDescription: z.string().max(400),
  })
  .strict();
export type CompanyAnalystVariables = z.infer<
  typeof CompanyAnalystVariablesSchema
>;

export const COMPANY_ANALYST_UNTRUSTED = [
  "userMessage",
  "conversation",
  "authorisedFacts",
] as const;

/**
 * The analyst's answer. `answer` is the user-visible text; the rest is
 * structure the runtime can check and later surface as result blocks.
 * A recommendation is a recommendation: never a decision, never a score.
 */
export const CompanyAnalystResultSchema = z
  .object({
    /** Plain-English reply to the person. Markdown allowed, headings only when they help. */
    answer: z.string().trim().min(1).max(TEXT_MAX),
    /** CONCISE for simple factual/operational requests, ANALYTICAL for strategic ones. */
    responseShape: z.enum(["CONCISE", "ANALYTICAL"]),
    findings: z.array(ModelFindingSchema).max(LIST_MAX).default([]),
    /** Material things the supplied context does not establish. */
    missingEvidence: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** Supplied facts that conflict; both sides stated, neither chosen. */
    contradictions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** True when the request could not be answered from the supplied context. */
    insufficientEvidence: z.boolean(),
    recommendation: z
      .object({
        statement: ModelStatementSchema,
        confidence: QConfidenceLevelSchema,
        assumptions: z.array(ModelStatementSchema).max(10).default([]),
        wouldChangeIf: z.array(ModelStatementSchema).max(10).default([]),
      })
      .strict()
      .nullable(),
    clarifyingQuestions: z.array(ClarifyingQuestionSchema).max(3).default([]),
    /** True when the person asked for something outside authorised context or policy. */
    declined: z.boolean().default(false),
  })
  .strict();
export type CompanyAnalystResult = z.infer<typeof CompanyAnalystResultSchema>;

export const COMPANY_ANALYST_SCHEMA_NAME = "CompanyAnalystResult";
export const COMPANY_ANALYST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// v2 (CQ-Q-020 §41-§42)
// ---------------------------------------------------------------------------

/**
 * v1's variables plus the trusted institutional frame the Company
 * Intelligence specialist establishes before any model runs (§15-§17,
 * §20-§22): open disagreements, figures past their useful life, changes
 * between recorded readings, and dimensions nothing supports.
 *
 * TRUSTED, and outside the untrusted fence, because it is Capital Q's own
 * deterministic reading of institutional state rather than anybody's
 * assertion. The prompt tells the model it may not overturn it — a
 * contradiction the server found is not a thing a model gets to resolve.
 *
 * Defaulted to the empty string so the conversational answer path, which
 * has no such frame, renders exactly as it did under v1.
 */
export const CompanyAnalystV2VariablesSchema =
  CompanyAnalystVariablesSchema.extend({
    institutionalNotes: z
      .string()
      .max(6_000)
      .default("Nothing was established in advance for this request."),
  }).strict();
export type CompanyAnalystV2Variables = z.infer<
  typeof CompanyAnalystV2VariablesSchema
>;

export const COMPANY_ANALYST_V2_UNTRUSTED = [
  ...COMPANY_ANALYST_UNTRUSTED,
] as const;

/**
 * v1's result plus the structured company reading (§13, §14, §60).
 *
 * Every new field is defaulted: a model that answers in the v1 shape still
 * validates, so adding the structure did not narrow what the conversational
 * path accepts. The specialist is what asks for these fields and what
 * checks them; nothing here is trusted merely because it parsed.
 */
export const CompanyAnalystV2ResultSchema = CompanyAnalystResultSchema.extend({
  companyFindings: z
    .array(CompanyIntelligenceFindingSchema)
    .max(LIST_MAX)
    .default([]),
  coverage: z.array(CompanyDimensionCoverageSchema).max(16).default([]),
  materialChanges: z.array(CompanyMaterialChangeSchema).max(12).default([]),
}).strict();
export type CompanyAnalystV2Result = z.infer<
  typeof CompanyAnalystV2ResultSchema
>;

export const COMPANY_ANALYST_V2_SCHEMA_NAME = "CompanyAnalystResult";
export const COMPANY_ANALYST_V2_SCHEMA_VERSION = 2;
