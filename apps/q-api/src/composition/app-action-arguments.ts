import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  AppActionArgumentsResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type AppActionArgumentsResult,
  type AppActionArgumentsVariables,
} from "@capital-q/q-core";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * One declared app action's inputs, from the person's words, against the
 * tool's own input schema (HARDEN, ADR 0040 parity eval, 2026-10-02): used
 * when the turn reader named the action (askedAction) but gave no
 * arguments. One cheap FAST call; the tool resolves names and validates
 * everything again, under its own authorize step.
 */
const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 300,
  attemptTimeoutMs: 8_000,
} as const;

export function createAppActionArgumentReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly tools: QToolPort;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): (
  request: QAnswerRequest,
  input: { readonly tool: string; readonly utterance: string },
) => Promise<Record<string, unknown> | null> {
  const registry = createDefaultPromptRegistry();
  const { gateway, tools, logger } = dependencies;
  return async (request, input) => {
    // The tool as this run is offered it: never a tool the run does not hold.
    const offered = await tools.offer({
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      plan: request.plan,
    });
    const tool = offered.find((entry) => entry.definition.name === input.tool);
    if (tool === undefined) return null;
    const rendered = renderPrompt<AppActionArgumentsVariables>(registry, {
      task: "APP_ACTION_ARGUMENTS",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Fill the inputs from their words only.",
      variables: {
        utterance: input.utterance.slice(0, 2_000),
        toolName: tool.definition.name.slice(0, 80),
        toolDoes: tool.definition.description.slice(0, 600),
        inputSchema: JSON.stringify(tool.definition.inputJsonSchema).slice(
          0,
          4_000,
        ),
      },
    });
    try {
      const result = await gateway.execute<AppActionArgumentsResult>(
        {
          taskClass: "FAST_CLASSIFICATION",
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
          schema: AppActionArgumentsResultSchema,
          // The signal is the call's option, never part of the request:
          // the gateway's request contract is strict, and a request with a
          // signal in it was refused as invalid before any provider was
          // asked (parity eval 2026-10-02, runs 1371ff20 and e2556e58).
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      return result.output.kind === "STRUCTURED"
        ? AppActionArgumentsResultSchema.parse(result.output.value).arguments
        : null;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId, tool: input.tool },
        "app action arguments were not read",
      );
      return null;
    }
  };
}
