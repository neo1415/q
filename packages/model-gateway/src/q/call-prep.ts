import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  CallPrepResultV2Schema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type CallPrepResultV2,
  type CallPrepVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";

/**
 * Owner 2026-10-23: a call with one named counterpart, prepared in the
 * answer in one tool-free call. The caller gathers only what this person
 * may see (Context Firewall before the model); this writes from it. Null
 * when it could not be had: the caller answers the turn the usual way.
 */

const CALL_PREP_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 2_500,
  attemptTimeoutMs: 30_000,
} as const;

export type CallPrepWriter = (
  request: QAnswerRequest,
  input: Omit<
    CallPrepVariables,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >,
) => Promise<CallPrepResultV2 | null>;

export function createCallPrepWriter(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): CallPrepWriter {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return async (request, input) => {
    try {
      const rendered = renderPrompt<CallPrepVariables>(registry, {
        task: "CALL_PREP",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You prepare one person for one call, from what they may see; Capital Q decides what is shown.",
        variables: {
          viewerRole: input.viewerRole,
          counterpartName: input.counterpartName.trim().slice(0, 200),
          counterpartProfile: input.counterpartProfile.slice(0, 6_000),
          soFar: input.soFar.slice(0, 8_000),
          ownRecord: input.ownRecord.slice(0, 12_000),
          said: input.said.trim().slice(0, 1_000),
        },
      });
      const response = await dependencies.gateway.execute<CallPrepResultV2>(
        {
          taskClass: "NORMAL_DIALOGUE",
          // Their own record may be founder-private: the run's ceiling.
          sensitivity: request.plan.maxSensitivity,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget: CALL_PREP_BUDGET,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: request.tenantId,
            userId: request.actor.userId,
            qRunId: request.runId,
            correlationId: request.correlationId,
          },
        },
        // The signal is an execute option: the request schema is strict, so
        // a signal in the request body made every live call invalid (live
        // 2026-10-23, run 3ba29d7d: INVALID_REQUEST, no candidate tried).
        {
          schema: CallPrepResultV2Schema,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const read = CallPrepResultV2Schema.safeParse(response.output.value);
      return read.success ? read.data : null;
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "a call was not prepared; the turn is answered the usual way",
      );
      return null;
    }
  };
}
