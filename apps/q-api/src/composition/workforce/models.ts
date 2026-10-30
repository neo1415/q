import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  workforceCorrelationId,
  type ModelDataPosture,
  type ModelTextTaskClass,
  type ModelUsagePurpose,
} from "@capital-q/contracts";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DraftRedraftResultSchema,
  DraftReviewResultV2Schema,
  JobPlanResultV10Schema,
  normalisePlanV10,
  AnalysisCritiqueResultV3Schema,
  AnalysisDocumentResultV3Schema,
  ResearchFactsResultV3Schema,
  ResearchPlanResultV4Schema,
  ResearchBriefResultSchema,
  renderPrompt,
  type AnalysisCritiqueResult,
  type AnalysisCritiqueVariables,
  type AnalysisDocumentResult,
  type AnalysisWriteVariables,
  type ResearchFactsResult,
  type ResearchFactsVariables,
  type ResearchPlanResult,
  type ResearchPlanVariablesV5,
  type ResearchBriefResult,
  type ResearchBriefVariables,
  type AnalysisCritiqueResultV3,
  type AnalysisDocumentResultV3,
  type ResearchFactsResultV3,
  type ResearchPlanResultV4,
  SubstanceCritiqueResultSchema,
  type SubstanceCritiqueResult,
  type SubstanceCritiqueVariables,
  DiligenceQuestionsDraftResultSchema,
  type DiligenceQuestionsDraftResult,
  type DiligenceQuestionsVariables,
  DiligenceQuestionsShortenResultV2Schema,
  type DiligenceQuestionsShortenResultV2,
  type DiligenceQuestionsShortenVariables,
  ReplyReaderResultSchema,
  PlanReviewResultSchema,
  PlanWriteResultV2Schema,
  type PlanReviewResult,
  type PlanReviewVariables,
  type PlanWriteResult,
  type PlanWriteVariables,
  type DraftRedraftResult,
  type DraftRedraftVariables,
  type DraftReviewResultV2,
  type DraftReviewV2Variables,
  type EtiquettePurpose,
  type JobPlanResultV9Input,
  type JobPlanResultV10,
  type JobPlanVariablesV15Input,
  type ReplyReaderResult,
  type ReplyReaderVariables,
} from "@capital-q/q-core";

import { etiquetteFor, type EtiquetteSource } from "../etiquette.js";

/**
 * The workforce's own model calls (founder brief J1-J9, J7), each one
 * small structured call through the Q Model Gateway by task class, with a
 * versioned prompt and a schema-checked result. A failed, refused or
 * unreadable call is null: the caller's safe fallback applies (a draft is
 * held, a reply is treated as one the person should see first, a job is
 * not planned). Every call made inside a job carries the job and the agent
 * run in its correlation id, so the usage ledger prices each (J6).
 */

export type Who = { readonly tenantId: string; readonly userId: string };
export type Trace = { readonly jobId: string; readonly runId: string } | null;

type Frame =
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes";

export type ReviewVariables = Omit<DraftReviewV2Variables, Frame>;
export type RedraftVariables = Omit<DraftRedraftVariables, Frame>;
export type ReplyVariables = Omit<ReplyReaderVariables, Frame>;
/** JOB_PLAN v15's input: priorAnswer is absent when the job refers to none. */
export type PlanVariables = Omit<JobPlanVariablesV15Input, Frame>;
export type CritiqueVariables = Omit<SubstanceCritiqueVariables, Frame>;
export type DiligenceVariables = Omit<DiligenceQuestionsVariables, Frame>;
/**
 * RESEARCH_PLAN v5 (2026-10-29): the open questions code found after a
 * round and the queries already sent (both empty on the first round), and
 * the research brief code grounded (the selected facts only).
 */
export type ResearchPlanInput = Omit<ResearchPlanVariablesV5, Frame>;
/** RESEARCH_BRIEF v1: the request, their earlier words and the situation. */
export type ResearchBriefInput = Omit<ResearchBriefVariables, Frame>;
export type ResearchBriefOutput = ResearchBriefResult;
/** A planned question as code reads it; `primary` absent: not marked. */
export type ResearchPlanOutput = {
  readonly questions: readonly (ResearchPlanResult["questions"][number] & {
    readonly primary?: boolean | undefined;
  })[];
  /** Words for Capital Q's own company search; never sent outside. */
  readonly internalQuery?: string | null | undefined;
};
/** Facts as code reads them; measure and entity are the reader's labels. */
export type ResearchFactsOutput = {
  readonly facts: readonly (ResearchFactsResult["facts"][number] & {
    readonly measure?: string | null | undefined;
    readonly entity?: string | null | undefined;
  })[];
  readonly followUps: ResearchFactsResult["followUps"];
};
export type ResearchFactsInput = Omit<ResearchFactsVariables, Frame>;
export type AnalysisWriteInput = Omit<AnalysisWriteVariables, Frame>;
export type AnalysisCritiqueInput = Omit<AnalysisCritiqueVariables, Frame>;
/** Situation-first planning (S4): PLAN_WRITE v1 and PLAN_REVIEW v1. */
export type PlanWriteInput = Omit<PlanWriteVariables, Frame>;
export type PlanReviewInput = Omit<PlanReviewVariables, Frame>;

/** A deep-work call's result and what it cost (null cost: unpriced). */
export type Priced<O> = {
  readonly output: O;
  readonly costUsd: number | null;
  /** List elements the gateway refused and dropped (paths, never values). */
  readonly dropped?: readonly string[] | undefined;
};
export type ShortenQuestionsInput = {
  readonly companyName: string;
  /** Only the drafted questions over the send limit, in order. */
  readonly questions: readonly string[];
};

const SMALL = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 900,
  attemptTimeoutMs: 30_000,
} as const;
const CLASSIFY = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.005,
  maxOutputTokens: 300,
  attemptTimeoutMs: 10_000,
} as const;
/** A second specialist reads a whole document: more input, one verdict. */
const CRITIQUE = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.06,
  maxOutputTokens: 1_600,
  attemptTimeoutMs: 60_000,
} as const;
/**
 * Owner 2026-10-23: deep work's calls, each bounded on its own.
 *
 * Live 2026-10-29: the plan call stopped at exactly its 1,600-token
 * ceiling (12.4 s, the object unclosed); the gateway then asked again at
 * the model's maximum and timed out, and round one never searched. The
 * ledger's 48 hours: every STRUCTURED_EXTRACTION refusal on a long input
 * sat at 1,440-2,376 output tokens -- the plan's and the facts' ceilings --
 * while successful calls ran to 4,400. The schema admits 16 questions (code
 * keeps 12) and the output count includes any reasoning the provider
 * spends (these calls ask for none: the request's reasoning defaults to
 * NONE). Room for 16 questions with their second queries, and for 12
 * facts with their statements; at gpt-5.6-luna's $1.20 per million output
 * tokens 4,000 tokens cost about half a cent, inside each cap.
 */
export const RESEARCH_PLAN_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.04,
  maxOutputTokens: 4_000,
  attemptTimeoutMs: 45_000,
} as const;
export const RESEARCH_FACTS_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 4_800,
  attemptTimeoutMs: 60_000,
} as const;
/** A whole document in one structured object: room to finish it. */
export const ANALYSIS_WRITE_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.45,
  maxOutputTokens: 8_192,
  attemptTimeoutMs: 150_000,
} as const;
export const ANALYSIS_CRITIQUE_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.1,
  maxOutputTokens: 2_400,
  attemptTimeoutMs: 90_000,
} as const;
/** One brief per job: a whole situation in, a short judgement out. */
export const RESEARCH_BRIEF_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  // The same room as the plan's (a brief is a selection and a writer's
  // note): EVIDENCE_SYNTHESIS calls ran to 5,200 output tokens.
  maxOutputTokens: 4_000,
  attemptTimeoutMs: 45_000,
} as const;

type DeepBudget =
  | typeof RESEARCH_BRIEF_BUDGET
  | typeof RESEARCH_PLAN_BUDGET
  | typeof RESEARCH_FACTS_BUDGET
  | typeof ANALYSIS_WRITE_BUDGET
  | typeof ANALYSIS_CRITIQUE_BUDGET;

/**
 * v5 also writes the outcome, prerequisites, reasons and next actions.
 * Production 2026-10-25 (run 341b8d61): a market-research plan was cut off
 * at 2,800 tokens and lost. The ceiling is sized for a whole plan of the
 * kind the request needs (four steps with their reasons, prerequisites and
 * next actions, with room to close the object), and the money for a third
 * attempt at that size -- a plan that cannot finish is no plan.
 */
export const PLAN_BUDGET = {
  // F-78: one refused answer lost the whole plan; another attempt (the
  // gateway's next route, with the room raised after a cut-off) is cheap
  // beside telling them Q failed.
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.25,
  maxOutputTokens: 6_000,
  attemptTimeoutMs: 60_000,
} as const;
const PLAN = PLAN_BUDGET;
/**
 * Situation-first planning (S4): a whole plan of up to 12 cited steps in
 * one structured object, and one reviewer's rubric with its defects. Each
 * bounded on its own; the plan job makes at most six such calls.
 */
export const PLAN_WRITE_BUDGET = {
  // One attempt: a refused plan is asked again by the job WITH the
  // refused fields (live 2026-10-29: the gateway's identical second attempt
  // failed exactly as the first, 7 times).
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.2,
  // Room for the reasoning beside a 12-step plan.
  maxOutputTokens: 9_000,
  attemptTimeoutMs: 90_000,
} as const;
export const PLAN_REVIEW_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.1,
  maxOutputTokens: 5_000,
  attemptTimeoutMs: 75_000,
} as const;
/**
 * Plan writing and reviewing are reasoning, not extraction (live
 * 2026-10-29: routed as STRUCTURED_EXTRACTION -- BASIC floor, 15 s target,
 * no reasoning -- the drafts were generic and scored 65-91). Evidence
 * synthesis, with the model's reasoning on.
 */
export const PLAN_TASK_CLASS = "EVIDENCE_SYNTHESIS" as const;
export const PLAN_WRITE_REASONING = "MEDIUM" as const;
export const PLAN_REVIEW_REASONING = "MEDIUM" as const;

export type WorkforceModels = {
  readonly review: (
    who: Who,
    trace: Trace,
    variables: ReviewVariables,
  ) => Promise<DraftReviewResultV2 | null>;
  readonly redraft: (
    who: Who,
    trace: Trace,
    variables: RedraftVariables,
  ) => Promise<string | null>;
  readonly readReply: (
    who: Who,
    trace: Trace,
    variables: ReplyVariables,
  ) => Promise<ReplyReaderResult | null>;
  readonly plan: (
    who: Who,
    trace: Trace,
    variables: PlanVariables,
    // The input shape: firstRead may be absent (an older plan, a fake).
  ) => Promise<JobPlanResultV9Input | null>;
  readonly critique: (
    who: Who,
    trace: Trace,
    variables: CritiqueVariables,
  ) => Promise<SubstanceCritiqueResult | null>;
  readonly diligenceQuestions: (
    who: Who,
    trace: Trace,
    variables: DiligenceVariables,
  ) => Promise<DiligenceQuestionsDraftResult | null>;
  /**
   * The repair for drafted questions over the send limit: the same number
   * back, in order, each rewritten (v2: up to the draft length; the caller
   * checks each against the send limit). Null when the call fails or the
   * count differs; the caller then files nothing.
   */
  readonly shortenDiligenceQuestions: (
    who: Who,
    trace: Trace,
    input: ShortenQuestionsInput,
  ) => Promise<readonly string[] | null>;
  /**
   * Owner 2026-10-29: what a research question needs, decided from the
   * person's situation before anything is planned.
   */
  readonly researchBrief?: (
    who: Who,
    trace: Trace,
    input: ResearchBriefInput,
  ) => Promise<Priced<ResearchBriefOutput> | null>;
  /**
   * Owner 2026-10-23: the focused searches deep research runs. Null when
   * no plan came back; `onFailed` says why when the call failed (the
   * gateway's failure class, or null for anything else), so a transient
   * failure can be asked again.
   */
  readonly planResearch: (
    who: Who,
    trace: Trace,
    input: ResearchPlanInput,
    options?: { readonly onFailed?: (failureClass: string | null) => void },
  ) => Promise<Priced<ResearchPlanOutput> | null>;
  /** The dated, sourced facts in one question's public pages. */
  readonly researchFacts: (
    who: Who,
    trace: Trace,
    input: ResearchFactsInput,
  ) => Promise<Priced<ResearchFactsOutput> | null>;
  /** An analysis document, or its revision from the review. */
  readonly writeAnalysis: (
    who: Who,
    trace: Trace,
    input: AnalysisWriteInput,
  ) => Promise<Priced<AnalysisDocumentResult> | null>;
  /** A second analyst's verdict on it. */
  readonly critiqueAnalysis: (
    who: Who,
    trace: Trace,
    input: AnalysisCritiqueInput,
  ) => Promise<Priced<AnalysisCritiqueResult> | null>;
  /** Situation-first planning: the person's plan from their situation. */
  readonly writePlan?: (
    who: Who,
    trace: Trace,
    input: PlanWriteInput,
    /**
     * Called when the schema refused the whole plan: the refused fields
     * (paths and Zod codes, never a value), so the job can ask once more
     * with them.
     */
    onRefused?: (refusals: readonly string[]) => void,
  ) => Promise<PlanWriteResult | null>;
  /** One independent review of it, against plan-rubric/v1. */
  readonly reviewPlan?: (
    who: Who,
    trace: Trace,
    input: PlanReviewInput,
  ) => Promise<PlanReviewResult | null>;
};

export function createWorkforceModels(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  /** ADR 0050: the principal's guides, which the reviewer grades against. */
  readonly etiquette?: EtiquetteSource | undefined;
  readonly purpose?: ModelUsagePurpose | undefined;
}): WorkforceModels {
  const registry = createDefaultPromptRegistry();

  type CallInput<V, O> = {
    readonly task:
      | "DRAFT_REVIEW"
      | "DRAFT_REDRAFT"
      | "REPLY_READER"
      | "JOB_PLAN"
      | "SUBSTANCE_CRITIQUE"
      | "DILIGENCE_QUESTIONS"
      | "DILIGENCE_QUESTIONS_SHORTEN"
      | "RESEARCH_PLAN"
      | "RESEARCH_BRIEF"
      | "RESEARCH_FACTS"
      | "ANALYSIS_WRITE"
      | "ANALYSIS_CRITIQUE"
      | "PLAN_WRITE"
      | "PLAN_REVIEW";
    readonly taskClass: ModelTextTaskClass;
    readonly who: Who;
    readonly trace: Trace;
    readonly variables: V;
    readonly schema: z.ZodType<O>;
    readonly budget:
      | typeof SMALL
      | typeof CLASSIFY
      | typeof PLAN
      | typeof CRITIQUE
      | typeof PLAN_WRITE_BUDGET
      | typeof PLAN_REVIEW_BUDGET
      | DeepBudget;
    readonly environmentNotes: string;
    readonly etiquette: EtiquettePurpose | null;
    /** A malformed element of a list costs that element alone (gateway DROP). */
    readonly dropListItems?: boolean | undefined;
    /** The model's own reasoning effort; none when not said. */
    readonly reasoning?: "LOW" | "MEDIUM" | "HIGH" | undefined;
    /** The schema refused the whole object: its refused fields (paths). */
    readonly onRefused?: ((refusals: readonly string[]) => void) | undefined;
    /** The call failed: the gateway's failure class, or null (other). */
    readonly onFailed?: ((failureClass: string | null) => void) | undefined;
  };

  async function call<V, O>(input: CallInput<V, O>): Promise<O | null> {
    return (await priced(input))?.output ?? null;
  }

  async function priced<V, O>(
    input: CallInput<V, O>,
  ): Promise<Priced<O> | null> {
    try {
      const etiquette =
        input.etiquette === null
          ? undefined
          : await etiquetteFor(
              dependencies.etiquette,
              input.who,
              input.etiquette,
            );
      const rendered = renderPrompt<V>(registry, {
        task: input.task,
        ...(etiquette === undefined ? {} : { etiquette }),
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: input.environmentNotes,
        variables: input.variables,
      });
      const response = await dependencies.gateway.execute<O>(
        {
          taskClass: input.taskClass,
          sensitivity: "CONFIDENTIAL",
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget: input.budget,
          ...(input.reasoning === undefined
            ? {}
            : { reasoning: input.reasoning }),
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            purpose: dependencies.purpose ?? "DELEGATED_WORK",
            tenantId: input.who.tenantId,
            userId: input.who.userId,
            correlationId:
              input.trace === null
                ? `cor_${randomUUID()}`
                : workforceCorrelationId(input.trace.jobId, input.trace.runId),
          },
        },
        {
          schema: input.schema,
          ...(input.dropListItems === true
            ? { invalidListItems: "DROP" as const }
            : {}),
        },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = input.schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      if (!parsed.success) return null;
      const amount = (
        response as { readonly cost?: { readonly amount?: unknown } }
      ).cost?.amount;
      const dropped = (response.output as { readonly dropped?: unknown })
        .dropped;
      return {
        output: parsed.data,
        costUsd:
          typeof amount === "number" && Number.isFinite(amount) ? amount : null,
        ...(Array.isArray(dropped) && dropped.length > 0
          ? {
              dropped: dropped.filter(
                (path): path is string => typeof path === "string",
              ),
            }
          : {}),
      };
    } catch (error: unknown) {
      const refusals = (error as { readonly refusals?: unknown } | null)
        ?.refusals;
      const refused = Array.isArray(refusals)
        ? refusals.filter((one): one is string => typeof one === "string")
        : [];
      // Paths and codes only, never a value the model wrote.
      dependencies.logger?.warn(
        {
          err: error,
          task: input.task,
          ...(refused.length > 0 ? { refusals: refused } : {}),
        },
        "workforce model call not made",
      );
      if (refused.length > 0) input.onRefused?.(refused);
      input.onFailed?.(isModelGatewayError(error) ? error.failureClass : null);
      return null;
    }
  }

  return {
    review: (who, trace, variables) =>
      call<ReviewVariables, DraftReviewResultV2>({
        task: "DRAFT_REVIEW",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: DraftReviewResultV2Schema,
        budget: SMALL,
        environmentNotes:
          "You are grading, not writing to anyone. Code decides from your grades whether anything is sent.",
        // The reviewer reads the guides as the writer does: the same frame.
        etiquette: "SPEAK_FOR",
      }),
    redraft: async (who, trace, variables) => {
      const result = await call<RedraftVariables, DraftRedraftResult>({
        task: "DRAFT_REDRAFT",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: DraftRedraftResultSchema,
        budget: SMALL,
        environmentNotes:
          "Your redraft is graded again before anything is sent.",
        etiquette: "SPEAK_FOR",
      });
      return result?.body ?? null;
    },
    readReply: (who, trace, variables) =>
      call<ReplyVariables, ReplyReaderResult>({
        task: "REPLY_READER",
        taskClass: "FAST_CLASSIFICATION",
        who,
        trace,
        variables,
        schema: ReplyReaderResultSchema,
        budget: CLASSIFY,
        environmentNotes:
          "You are reading a message, not replying. Code acts only on what you report.",
        etiquette: null,
      }),
    plan: async (who, trace, variables) => {
      // v10's tolerant result, normalised back to v9's shape (keys and
      // their references in the plan's key form, text clipped).
      const ask = () =>
        priced<PlanVariables, JobPlanResultV10>({
          task: "JOB_PLAN",
          taskClass: "STRUCTURED_EXTRACTION",
          who,
          trace,
          variables,
          schema: JobPlanResultV10Schema,
          budget: PLAN,
          environmentNotes:
            "You are planning, not acting. Code checks every step against what they allowed before anything happens.",
          etiquette: null,
          // A step with an unknown role is dropped; code then refuses what
          // waited on it and replans, never runs a partial plan unchecked.
          dropListItems: true,
        });
      // Production 2026-10-25 (run 341b8d61): a retry kept no step -- every
      // one dropped -- and was offered as a 0-step plan. A plan whose steps
      // were all dropped is no plan: asked once more, then refused.
      const emptied = (plan: Priced<JobPlanResultV10> | null) =>
        plan !== null &&
        plan.output.steps.length === 0 &&
        (plan.dropped ?? []).some((path) => path.startsWith("steps"));
      let plan = await ask();
      if (emptied(plan)) {
        dependencies.logger?.warn(
          { task: "JOB_PLAN", dropped: plan?.dropped ?? [] },
          "workforce plan kept no step; asked again",
        );
        plan = await ask();
      }
      if (plan === null || emptied(plan)) return null;
      return normalisePlanV10(plan.output);
    },
    critique: (who, trace, variables) =>
      call<CritiqueVariables, SubstanceCritiqueResult>({
        task: "SUBSTANCE_CRITIQUE",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: SubstanceCritiqueResultSchema,
        budget: CRITIQUE,
        environmentNotes:
          "You are reviewing, not writing. Code decides from your verdict whether the document is revised.",
        etiquette: null,
      }),
    diligenceQuestions: (who, trace, variables) =>
      call<DiligenceVariables, DiligenceQuestionsDraftResult>({
        task: "DILIGENCE_QUESTIONS",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: DiligenceQuestionsDraftResultSchema,
        budget: SMALL,
        environmentNotes:
          "You are drafting questions for the person's approval. Nothing is sent until they approve.",
        etiquette: null,
      }),
    // Live 2026-10-24 (batch 5): tolerant results, clipped here to the
    // shapes code reads; a malformed list element costs that element.
    planResearch: async (who, trace, variables, options) => {
      const result = await priced<ResearchPlanInput, ResearchPlanResultV4>({
        onFailed: options?.onFailed,
        task: "RESEARCH_PLAN",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: ResearchPlanResultV4Schema,
        budget: RESEARCH_PLAN_BUDGET,
        environmentNotes:
          "You are planning searches, not running them. Code composes every query before anything leaves Capital Q.",
        etiquette: null,
        dropListItems: true,
      });
      if (result === null) return null;
      return {
        costUsd: result.costUsd,
        output: {
          questions: result.output.questions.slice(0, 12).map((one) => ({
            lane: one.lane.slice(0, 40),
            query: one.query.slice(0, 160),
            alsoQuery:
              one.alsoQuery === null ? null : one.alsoQuery.slice(0, 160),
            recent: one.recent,
            primary: one.primary,
          })),
          internalQuery:
            result.output.internalQuery === null ||
            result.output.internalQuery.length === 0
              ? null
              : result.output.internalQuery.slice(0, 120),
        },
      };
    },
    researchBrief: (who, trace, variables) =>
      priced<ResearchBriefInput, ResearchBriefResult>({
        task: "RESEARCH_BRIEF",
        taskClass: "EVIDENCE_SYNTHESIS",
        who,
        trace,
        variables,
        schema: ResearchBriefResultSchema,
        budget: RESEARCH_BRIEF_BUDGET,
        environmentNotes:
          "You are briefing research, not running it. Code checks every reference and composes every query before anything leaves Capital Q.",
        etiquette: null,
        dropListItems: true,
      }),
    researchFacts: async (who, trace, variables) => {
      const result = await priced<ResearchFactsInput, ResearchFactsResultV3>({
        task: "RESEARCH_FACTS",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: ResearchFactsResultV3Schema,
        budget: RESEARCH_FACTS_BUDGET,
        environmentNotes:
          "You are reading public pages, not answering anyone. Code keeps a fact only when its numbers are on its page.",
        etiquette: null,
        dropListItems: true,
      });
      if (result === null) return null;
      return {
        costUsd: result.costUsd,
        output: {
          facts: result.output.facts.slice(0, 12).map((fact) => ({
            statement: prose(fact.statement, 400),
            figure: fact.figure === null ? null : fact.figure.slice(0, 80),
            asOf: fact.asOf === null ? null : fact.asOf.slice(0, 40),
            source: fact.source,
            kind: fact.kind,
            measure: fact.measure === null ? null : fact.measure.slice(0, 60),
            entity: fact.entity === null ? null : fact.entity.slice(0, 60),
          })),
          followUps: result.output.followUps.slice(0, 3).map((one) => ({
            lane: one.lane.slice(0, 40),
            query: one.query.slice(0, 160),
          })),
        },
      };
    },
    writeAnalysis: async (who, trace, variables) => {
      const result = await priced<AnalysisWriteInput, AnalysisDocumentResultV3>(
        {
          task: "ANALYSIS_WRITE",
          taskClass: "EVIDENCE_SYNTHESIS",
          who,
          trace,
          variables,
          schema: AnalysisDocumentResultV3Schema,
          budget: ANALYSIS_WRITE_BUDGET,
          environmentNotes:
            "You are writing a document for the person's own team. A second analyst reviews it before it is filed; nothing is sent to anyone.",
          etiquette: null,
        },
      );
      if (result === null) return null;
      const draft = result.output;
      const sections = draft.sections.filter(
        (section) => section.heading !== "" && section.body !== "",
      );
      if (sections.length === 0) return null;
      return {
        costUsd: result.costUsd,
        output: {
          title: prose(draft.title, 150),
          summary: prose(draft.summary, 600),
          // Long bodies are kept whole: the filed document splits them.
          sections: sections.slice(0, 16).map((section) => ({
            heading: prose(section.heading, 120),
            body: section.body,
          })),
          topRecommendations: draft.topRecommendations
            .slice(0, 3)
            .map((one) => prose(one, 300)),
          gaps: draft.gaps.slice(0, 12).map((gap) => prose(gap, 300)),
        },
      };
    },
    critiqueAnalysis: async (who, trace, variables) => {
      const result = await priced<
        AnalysisCritiqueInput,
        AnalysisCritiqueResultV3
      >({
        task: "ANALYSIS_CRITIQUE",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: AnalysisCritiqueResultV3Schema,
        budget: ANALYSIS_CRITIQUE_BUDGET,
        environmentNotes:
          "You are reviewing, not writing. Code decides from your verdict whether the document is revised again.",
        etiquette: null,
        dropListItems: true,
      });
      if (result === null) return null;
      const verdict = result.output;
      return {
        costUsd: result.costUsd,
        output: {
          passes: verdict.passes,
          score: Math.round(verdict.score),
          issues: verdict.issues.slice(0, 10).map((issue) => ({
            kind: issue.kind,
            section: issue.section.slice(0, 120),
            problem: prose(issue.problem, 400),
            fix: prose(issue.fix, 400),
          })),
          strengths: verdict.strengths
            .slice(0, 3)
            .map((one) => prose(one, 300)),
        },
      };
    },
    writePlan: (who, trace, input, onRefused) =>
      call<PlanWriteInput, PlanWriteResult>({
        task: "PLAN_WRITE",
        taskClass: PLAN_TASK_CLASS,
        who,
        trace,
        variables: input,
        schema: PlanWriteResultV2Schema,
        budget: PLAN_WRITE_BUDGET,
        reasoning: PLAN_WRITE_REASONING,
        // A list over its bound keeps its first items (reported, never
        // repaired); one stray element never refuses the whole plan.
        dropListItems: true,
        onRefused,
        environmentNotes:
          "You plan; nothing runs from your plan until the person accepts it, and every outward or consequential step is approved by them first.",
        etiquette: null,
      }),
    reviewPlan: (who, trace, input) =>
      call<PlanReviewInput, PlanReviewResult>({
        task: "PLAN_REVIEW",
        taskClass: PLAN_TASK_CLASS,
        who,
        trace,
        variables: input,
        schema: PlanReviewResultSchema,
        budget: PLAN_REVIEW_BUDGET,
        reasoning: PLAN_REVIEW_REASONING,
        dropListItems: true,
        environmentNotes:
          "You are reviewing, not writing. Code recomputes your score and decides whether the plan is redrafted.",
        etiquette: null,
      }),
    shortenDiligenceQuestions: async (who, trace, input) => {
      const count = input.questions.length;
      if (count < 1 || count > 5) return null;
      const result = await call<
        Omit<DiligenceQuestionsShortenVariables, Frame>,
        DiligenceQuestionsShortenResultV2
      >({
        task: "DILIGENCE_QUESTIONS_SHORTEN",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables: {
          companyName: input.companyName,
          count: String(count),
          questions: input.questions
            .map((question, index) => `${String(index + 1)}. ${question}`)
            .join("\n"),
        },
        // v2: accepted at draft length; the caller checks each rewrite
        // against the send limit and asks again only for one still over.
        schema: DiligenceQuestionsShortenResultV2Schema,
        budget: SMALL,
        environmentNotes:
          "You are shortening questions for the person's approval. Nothing is sent until they approve.",
        etiquette: null,
      });
      // One rewrite per question given, or none: a merged or dropped
      // question would silently change what the investor approves.
      if (result === null || result.questions.length !== count) return null;
      return result.questions.map((one) => one.question);
    },
  };
}

/**
 * Prose a person reads, within its stored bound: cut at a word, with an
 * ellipsis, never mid-word (live 2026-10-24: "…a month-12 decision, not a
 * committed rollou").
 */
export function prose(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
