import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  WorkConverseResultSchema,
  WorkInterviewReportResultSchema,
  WorkInterviewTurnResultSchema,
  WorkShortlistResultSchema,
  WorkStandInReplyResultSchema,
  type WorkConverseResult,
  type WorkConverseVariables,
  type WorkInterviewReportResult,
  type WorkInterviewReportVariables,
  type WorkInterviewTurnResult,
  type WorkInterviewTurnVariables,
  type WorkShortlistResult,
  type WorkShortlistVariables,
  type WorkStandInReplyResult,
  type WorkStandInReplyVariables,
} from "@capital-q/q-core";

/**
 * The words Q writes inside delegated work (AUTO, ADR 0029), each one
 * small structured call through the Q Model Gateway by task class, with a
 * versioned prompt and a schema-checked result. A failed or refused call is
 * null: the engine waits and tries again; it never invents a reply.
 */

type Who = { readonly tenantId: string; readonly userId: string };

const SMALL = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 900,
  attemptTimeoutMs: 30_000,
} as const;
const LARGE = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 2_000,
  attemptTimeoutMs: 60_000,
} as const;

type TaskVariables = {
  WORK_SHORTLIST: Omit<
    WorkShortlistVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
  WORK_CONVERSE: Omit<
    WorkConverseVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
  WORK_INTERVIEW_TURN: Omit<
    WorkInterviewTurnVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
  WORK_INTERVIEW_REPORT: Omit<
    WorkInterviewReportVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
  WORK_STAND_IN_REPLY: Omit<
    WorkStandInReplyVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
};

export function createWorkComposers(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}) {
  const registry = createDefaultPromptRegistry();

  async function call<K extends keyof TaskVariables, O>(
    task: K,
    who: Who,
    variables: TaskVariables[K],
    schema: z.ZodType<O>,
    budget: typeof SMALL | typeof LARGE,
    environmentNotes: string,
  ): Promise<O | null> {
    try {
      const rendered = renderPrompt<TaskVariables[K]>(registry, {
        task,
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes,
        variables,
      });
      const response = await dependencies.gateway.execute<O>(
        {
          taskClass: "STRUCTURED_EXTRACTION",
          sensitivity: "CONFIDENTIAL",
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: who.tenantId,
            userId: who.userId,
            correlationId: `cor_${randomUUID()}`,
          },
        },
        { schema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, task },
        "q work words not written",
      );
      return null;
    }
  }

  const CHAT_NOTE =
    "Your reply is posted in a relationship chat on Capital Q, marked as sent by Q.";

  return {
    shortlist: (who: Who, variables: TaskVariables["WORK_SHORTLIST"]) =>
      call<"WORK_SHORTLIST", WorkShortlistResult>(
        "WORK_SHORTLIST",
        who,
        variables,
        WorkShortlistResultSchema,
        LARGE,
        "You are choosing, not writing to anyone. Nothing is sent until code acts on your picks.",
      ),
    converse: (who: Who, variables: TaskVariables["WORK_CONVERSE"]) =>
      call<"WORK_CONVERSE", WorkConverseResult>(
        "WORK_CONVERSE",
        who,
        variables,
        WorkConverseResultSchema,
        SMALL,
        CHAT_NOTE,
      ),
    interviewTurn: (
      who: Who,
      variables: TaskVariables["WORK_INTERVIEW_TURN"],
    ) =>
      call<"WORK_INTERVIEW_TURN", WorkInterviewTurnResult>(
        "WORK_INTERVIEW_TURN",
        who,
        variables,
        WorkInterviewTurnResultSchema,
        SMALL,
        CHAT_NOTE,
      ),
    report: (who: Who, variables: TaskVariables["WORK_INTERVIEW_REPORT"]) =>
      call<"WORK_INTERVIEW_REPORT", WorkInterviewReportResult>(
        "WORK_INTERVIEW_REPORT",
        who,
        variables,
        WorkInterviewReportResultSchema,
        LARGE,
        "Your report is read only by the investor who asked for it, in Capital Q and as a PDF.",
      ),
    standInReply: (who: Who, variables: TaskVariables["WORK_STAND_IN_REPLY"]) =>
      call<"WORK_STAND_IN_REPLY", WorkStandInReplyResult>(
        "WORK_STAND_IN_REPLY",
        who,
        variables,
        WorkStandInReplyResultSchema,
        SMALL,
        CHAT_NOTE,
      ),
  };
}

export type WorkComposers = ReturnType<typeof createWorkComposers>;
