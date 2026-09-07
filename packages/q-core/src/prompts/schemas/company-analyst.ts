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
