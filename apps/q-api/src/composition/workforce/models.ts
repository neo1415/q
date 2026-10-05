import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  workforceCorrelationId,
  type ModelDataPosture,
  type ModelTextTaskClass,
  type ModelUsagePurpose,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DraftRedraftResultSchema,
  DraftReviewResultSchema,
  JobPlanResultSchema,
  renderPrompt,
  ReplyReaderResultSchema,
  type DraftRedraftResult,
  type DraftRedraftVariables,
  type DraftReviewResult,
  type DraftReviewVariables,
  type EtiquettePurpose,
  type JobPlanResult,
  type JobPlanVariables,
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

export type ReviewVariables = Omit<DraftReviewVariables, Frame>;
export type RedraftVariables = Omit<DraftRedraftVariables, Frame>;
export type ReplyVariables = Omit<ReplyReaderVariables, Frame>;
export type PlanVariables = Omit<JobPlanVariables, Frame>;

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
const PLAN = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 2_000,
  attemptTimeoutMs: 60_000,
} as const;

export type WorkforceModels = {
  readonly review: (
    who: Who,
    trace: Trace,
    variables: ReviewVariables,
  ) => Promise<DraftReviewResult | null>;
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
  ) => Promise<JobPlanResult | null>;
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

  async function call<V, O>(input: {
    readonly task:
      "DRAFT_REVIEW" | "DRAFT_REDRAFT" | "REPLY_READER" | "JOB_PLAN";
    readonly taskClass: ModelTextTaskClass;
    readonly who: Who;
    readonly trace: Trace;
    readonly variables: V;
    readonly schema: z.ZodType<O>;
    readonly budget: typeof SMALL | typeof CLASSIFY | typeof PLAN;
    readonly environmentNotes: string;
    readonly etiquette: EtiquettePurpose | null;
  }): Promise<O | null> {
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
        { schema: input.schema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = input.schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, task: input.task },
        "workforce model call not made",
      );
      return null;
    }
  }

  return {
    review: (who, trace, variables) =>
      call<ReviewVariables, DraftReviewResult>({
        task: "DRAFT_REVIEW",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: DraftReviewResultSchema,
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
    plan: (who, trace, variables) =>
      call<PlanVariables, JobPlanResult>({
        task: "JOB_PLAN",
        taskClass: "STRUCTURED_EXTRACTION",
        who,
        trace,
        variables,
        schema: JobPlanResultSchema,
        budget: PLAN,
        environmentNotes:
          "You are planning, not acting. Code checks every step against what they allowed before anything happens.",
        etiquette: null,
      }),
  };
}
