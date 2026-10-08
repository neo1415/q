import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  SmallTalkResultSchema,
  type PromptRegistry,
  type SmallTalkResult,
  type SmallTalkVariables,
} from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";

/**
 * RECOVERY-2026-10 B5 (audit B-05): small talk in one short, tool-free
 * call. The analyst path paid for prefetch reads and a call offering ~127
 * tool definitions with a ~37k-character prompt; this sends the charter,
 * a short task and the last few turns, about 2k characters, with no tools.
 * Null when it could not be had or said something it must not (a claim of
 * work done): the caller then answers the turn the full way, never silence.
 */

/** Small and quick: a reply of a sentence or three. */
const SMALL_TALK_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 300,
  attemptTimeoutMs: 8_000,
} as const;

export type SmallTalkTurn = {
  readonly role: "USER" | "Q";
  readonly text: string;
};

export type SmallTalkReply = (
  request: QAnswerRequest,
  input: { readonly said: string; readonly recent: readonly SmallTalkTurn[] },
) => Promise<string | null>;

/** "I've saved/sent/booked…": small talk never did anything. */
const CLAIMS_WORK =
  /\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:saved|sent|booked|updated|changed|looked\s+(?:it\s+)?up|checked|found|prepared|scheduled))\b/iu;

export function createSmallTalkReply(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): SmallTalkReply {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return async (request, input) => {
    try {
      const rendered = renderPrompt<SmallTalkVariables>(registry, {
        task: "SMALL_TALK",
        operatingMode: "DEBRIEF",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are chatting with the person; nothing of theirs was read for this reply.",
        variables: {
          said: input.said.trim().slice(0, 1_000),
          recentTurns: JSON.stringify(
            input.recent
              .slice(-6)
              .map((turn) => ({
                role: turn.role,
                text: turn.text.slice(0, 400),
              })),
          ).slice(0, 3_000),
        },
      });
      const response = await dependencies.gateway.execute<SmallTalkResult>(
        {
          taskClass: "NORMAL_DIALOGUE",
          // The turns may carry what they said earlier: the run's ceiling.
          sensitivity: request.plan.maxSensitivity,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget: SMALL_TALK_BUDGET,
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
        { schema: SmallTalkResultSchema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const read = SmallTalkResultSchema.safeParse(response.output.value);
      if (!read.success) return null;
      const say = read.data.say.trim();
      return say.length === 0 || CLAIMS_WORK.test(say) ? null : say;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "small talk was not answered cheaply; the full path answers it",
      );
      return null;
    }
  };
}
