import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  ConversationRecallResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ConversationRecallResult,
  type ConversationRecallVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";

/**
 * Owner live 2026-10-17: a follow-up about what Q already said or showed,
 * answered from Capital Q's record of it (conversationContextOf) in one
 * tool-free call. Nothing is looked up, ranked or read: the record is this
 * conversation's own stored turns, which this person was already shown.
 * Null when the record does not hold the answer, or the reply claims work
 * done: the caller then answers the turn the full way, never silence.
 */

const CONVERSATION_RECALL_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.02,
  maxOutputTokens: 500,
  attemptTimeoutMs: 8_000,
} as const;

export type ConversationRecallTurn = {
  readonly role: "USER" | "Q";
  readonly text: string;
};

export type ConversationRecall = (
  request: QAnswerRequest,
  input: {
    readonly said: string;
    readonly recent: readonly ConversationRecallTurn[];
    readonly shown: string;
    readonly turn: number;
  },
) => Promise<string | null>;

/** "I've opened/checked/looked up…": a recall reads nothing and does nothing. */
const CLAIMS_WORK =
  /\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:opened|saved|sent|booked|updated|changed|refreshed|re-?ran|looked\s+(?:it\s+)?up|checked|searched))\b/iu;

export function createConversationRecall(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): ConversationRecall {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return async (request, input) => {
    const shown = input.shown.trim();
    if (shown.length === 0) return null;
    try {
      const rendered = renderPrompt<ConversationRecallVariables>(registry, {
        task: "CONVERSATION_RECALL",
        operatingMode: "DEBRIEF",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are answering from what you already told them in this conversation; nothing new was read for this reply.",
        variables: {
          said: input.said.trim().slice(0, 1_000),
          recentTurns: JSON.stringify(
            input.recent.slice(-6).map((turn) => ({
              role: turn.role,
              text: turn.text.slice(0, 400),
            })),
          ).slice(0, 3_000),
          shown: shown.slice(0, 9_000),
          turn: input.turn,
        },
      });
      const response =
        await dependencies.gateway.execute<ConversationRecallResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            // The record carries what this run may see: its own ceiling.
            sensitivity: request.plan.maxSensitivity,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: CONVERSATION_RECALL_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: request.tenantId,
              userId: request.actor.userId,
              qRunId: request.runId,
              correlationId: request.correlationId,
            },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
          { schema: ConversationRecallResultSchema },
        );
      if (response.output.kind !== "STRUCTURED") return null;
      const read = ConversationRecallResultSchema.safeParse(
        response.output.value,
      );
      if (!read.success || !read.data.answerable) return null;
      const say = read.data.say?.trim() ?? "";
      return say.length === 0 || CLAIMS_WORK.test(say) ? null : say;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "a follow-up was not answered from the conversation; the full path answers it",
      );
      return null;
    }
  };
}
