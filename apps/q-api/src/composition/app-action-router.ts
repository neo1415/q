import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  AppActionRouterResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type AppActionRouterResult,
  type AppActionRouterVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

/**
 * Which ONE declared app action a request to act asks for (lead
 * 2026-10-03, runs 9b4ef8d1, 7dd0bc2c, 31d085ac). Asked only when the turn
 * reader read a request to act and named no declared action: one small
 * FAST call over the person's words and the actions they may take here
 * (on any purpose, by the plan's scopes). The answer is checked against
 * that list; the action then runs through its own tool, authorize step and
 * approval card, exactly as when the reader names it.
 */
const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 120,
  attemptTimeoutMs: 6_000,
} as const;

export type RouterCandidate = {
  readonly name: string;
  readonly does: string;
  readonly short?: string | undefined;
  readonly area?: string | undefined;
};

/** One line per action: what the router is told, and nothing else. */
export function routerActionLines(
  candidates: readonly RouterCandidate[],
): string {
  return candidates
    .map(
      (action) =>
        `${action.name} -- ${action.area ?? "Other"}: ${(action.short ?? action.does).slice(0, 160)}`,
    )
    .join("\n");
}

export function createAppActionRouter(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  readonly registry?: PromptRegistry | undefined;
}): (
  request: QAnswerRequest,
  input: {
    readonly utterance: string;
    readonly candidates: readonly RouterCandidate[];
  },
) => Promise<string | null> {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return async (request, input) => {
    if (input.candidates.length === 0) return null;
    const started = Date.now();
    const rendered = renderPrompt<AppActionRouterVariables>(registry, {
      task: "APP_ACTION_ROUTER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Name one listed action or none.",
      variables: {
        utterance: input.utterance.slice(0, 2_000),
        actions: routerActionLines(input.candidates).slice(0, 12_000),
      },
    });
    try {
      const result = await gateway.execute<AppActionRouterResult>(
        {
          taskClass: "FAST_CLASSIFICATION",
          reasoning: "LOW",
          budget: BUDGET,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          sensitivity: request.plan.maxSensitivity,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: request.actor.tenantId,
            userId: request.actor.userId,
            qRunId: request.runId,
            correlationId: request.correlationId,
          },
        },
        {
          schema: AppActionRouterResultSchema,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      const named =
        result.output.kind === "STRUCTURED"
          ? AppActionRouterResultSchema.parse(result.output.value).action
          : null;
      // Only a listed name counts: the list is the closed set.
      const action =
        named !== null &&
        input.candidates.some((candidate) => candidate.name === named)
          ? named
          : null;
      logger?.info(
        {
          qRunId: request.runId,
          candidates: input.candidates.length,
          action,
          unlisted: named !== null && action === null,
          latencyMs: Date.now() - started,
        },
        "q app action routed",
      );
      return action;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId, latencyMs: Date.now() - started },
        "q app action not routed",
      );
      return null;
    }
  };
}
