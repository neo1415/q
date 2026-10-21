import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QClientActionToolResultSchema,
  QRunIdSchema,
  type ModelDataPosture,
  type QNavigationChoice,
  type QNavigationChooseResponse,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  NavigationChooserResultSchema,
  renderPrompt,
  type NavigationChooserResult,
  type NavigationChooserVariables,
} from "@capital-q/q-core";
import type { ContextFirewallPort, QToolPort } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * Lane 7 (owner 2026-10-21: "names must NOT be required"): the tie-break
 * when the screen's own reading of a pointing request ("open their deck")
 * is torn between two or three things it already showed the person.
 *
 * Order matters for privacy: each candidate is first opened as the person
 * through the tool that would open it (open_page by id; a data-room
 * document through open_company_document), under the firewall's plan for
 * them. Only those they may open are kept, and only those reach the model,
 * so context never surfaces a record or document they cannot see, even one
 * that was mentioned. One kept: chosen with no model. Two or three: one
 * FAST_CLASSIFICATION call, cut at a hard budget; NONE when it does not
 * answer in time (the screen then decides from its own scores).
 */
export type NavigationChooser = (
  actor: ActorContext,
  request: {
    readonly text: string;
    readonly candidates: readonly QNavigationChoice[];
  },
) => Promise<QNavigationChooseResponse>;

/** The model's whole budget: the screen is waiting. */
export const NAVIGATION_CHOOSER_BUDGET_MS = 700;

export function createNavigationChooser(dependencies: {
  readonly firewall: ContextFirewallPort;
  readonly tools: QToolPort;
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  readonly budgetMs?: number | undefined;
}): NavigationChooser {
  const registry = createDefaultPromptRegistry();
  const budgetMs = dependencies.budgetMs ?? NAVIGATION_CHOOSER_BUDGET_MS;
  return async (actor, request) => {
    const started = Date.now();
    const ms = () => Math.max(0, Date.now() - started);
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const decision = await dependencies.firewall
      .plan({ actor, runId, correlationId, capability: "ANSWER", subjects: [] })
      .catch(() => null);
    if (decision?.outcome !== "AUTHORISED") {
      return { kind: "NONE", allowed: [], ms: ms() };
    }
    const plan = decision.plan;
    const opens = async (choice: QNavigationChoice): Promise<boolean> => {
      const material = choice.page === "DATA_ROOM_DOCUMENT";
      if (material && choice.companyId === undefined) return false;
      const tool = material ? "open_company_document" : "open_page";
      const outcome = await dependencies.tools
        .execute(
          {
            callId: `q-choose-${choice.key}`,
            name: tool,
            arguments: material
              ? { documentId: choice.id, companyId: choice.companyId }
              : { page: choice.page, id: choice.id },
          },
          {
            actor,
            runId,
            correlationId,
            capability: "ANSWER",
            plan,
            focus: { areas: [], tools: [tool] },
          },
        )
        .catch(() => null);
      if (outcome?.result.ok !== true) return false;
      const read = QClientActionToolResultSchema.safeParse(outcome.result.data);
      return (
        read.success &&
        read.data.clientAction.kind === "OPEN_RECORD_PAGE" &&
        read.data.clientAction.id.toLowerCase() === choice.id.toLowerCase()
      );
    };
    const verdicts = await Promise.all(request.candidates.map(opens));
    const allowed = request.candidates.filter((_, index) => verdicts[index]);
    const only = allowed[0];
    if (allowed.length === 1 && only !== undefined) {
      return { kind: "CHOSEN", key: only.key, model: false, ms: ms() };
    }
    if (allowed.length === 0) return { kind: "NONE", allowed: [], ms: ms() };

    const keys = allowed.map((choice) => choice.key);
    const rendered = renderPrompt<NavigationChooserVariables>(registry, {
      task: "NAVIGATION_CHOOSER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Name one listed key or none.",
      variables: {
        utterance: request.text.slice(0, 400),
        candidates: allowed
          .map((choice) => `${choice.key}: ${choice.label.slice(0, 120)}`)
          .join("\n"),
      },
    });
    const left = Math.max(50, budgetMs - ms());
    const signal = AbortSignal.timeout(left);
    try {
      const result =
        await dependencies.gateway.execute<NavigationChooserResult>(
          {
            taskClass: "FAST_CLASSIFICATION",
            reasoning: "LOW",
            budget: {
              maxAttempts: 1,
              maxEstimatedCostUsd: 0.005,
              maxOutputTokens: 40,
              attemptTimeoutMs: left,
            },
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            sensitivity: plan.maxSensitivity,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              qRunId: undefined,
              correlationId,
            },
          },
          { schema: NavigationChooserResultSchema, signal },
        );
      const named =
        result.output.kind === "STRUCTURED"
          ? NavigationChooserResultSchema.parse(result.output.value).key
          : null;
      // Only a listed, allowed key counts.
      const key = named !== null && keys.includes(named) ? named : null;
      dependencies.logger?.info(
        { candidates: allowed.length, chosen: key !== null, ms: ms() },
        "q navigation chooser",
      );
      return key === null
        ? { kind: "NONE", allowed: keys, ms: ms() }
        : { kind: "CHOSEN", key, model: true, ms: ms() };
    } catch (error: unknown) {
      dependencies.logger?.info(
        { err: error, candidates: allowed.length, ms: ms() },
        "q navigation chooser undecided in time",
      );
      return { kind: "NONE", allowed: keys, ms: ms() };
    }
  };
}
