import { randomUUID } from "node:crypto";

import type {
  BriefingCommandRequest,
  BriefingCommandResultDto,
  ModelDataPosture,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  BriefingCommandResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type BriefingCommandResult,
  type BriefingCommandVariables,
} from "@capital-q/q-core";

/**
 * The arrival briefing's free-form words, read into typed card verbs
 * (Zino, 2026-10-08) by one small structured call through the Q Model
 * Gateway (BRIEFING_COMMAND v1). The cards are what is on the person's own
 * screen, sent back by their browser; the words are their own transcript
 * or typing. Nothing is acted on here: the browser's card sequence checks
 * every verb against the words and asks before any changed text goes.
 * A failed, refused or unreadable call is "unclear", never a guess.
 */

const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.02,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 15_000,
} as const;

export type Who = { readonly tenantId: string; readonly userId: string };

const UNCLEAR: BriefingCommandResultDto = { actions: [], unclear: true };

function todayIn(timeZone: string | null, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timeZone ?? "UTC",
    }).format(now);
  } catch {
    return now.toUTCString().slice(0, 16);
  }
}

export function createBriefingCommandReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly principalName?: ((who: Who) => Promise<string | null>) | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
}) {
  const registry = createDefaultPromptRegistry();
  return async (
    who: Who,
    request: BriefingCommandRequest,
  ): Promise<BriefingCommandResultDto> => {
    const refs = new Set(request.cards.map((card) => card.ref));
    try {
      const principalName =
        (await dependencies.principalName?.(who).catch(() => null)) ??
        "The person";
      const rendered = renderPrompt<BriefingCommandVariables>(registry, {
        task: "BRIEFING_COMMAND",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are reading their words about cards on their screen, not acting. Code checks every action before anything happens.",
        variables: {
          principalName: principalName.slice(0, 120),
          today: todayIn(
            request.timeZone,
            dependencies.now?.() ?? new Date(),
          ).slice(0, 80),
          words: request.words,
          cards: JSON.stringify(request.cards).slice(0, 12_000),
        },
      });
      const response =
        await dependencies.gateway.execute<BriefingCommandResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "CONVERSATION",
              tenantId: who.tenantId,
              userId: who.userId,
              correlationId: `cor_${randomUUID()}`,
            },
          },
          { schema: BriefingCommandResultSchema },
        );
      if (response.output.kind !== "STRUCTURED") return UNCLEAR;
      const parsed = BriefingCommandResultSchema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      if (!parsed.success) return UNCLEAR;
      // Only cards that are on their screen; a rewrite only with REWRITE.
      const actions = parsed.data.actions
        .filter((action) => refs.has(action.ref))
        .map((action) => ({
          ref: action.ref,
          verb: action.verb,
          rewrite: action.verb === "REWRITE" ? action.rewrite : null,
        }))
        .filter(
          (action) => action.verb !== "REWRITE" || action.rewrite !== null,
        );
      return {
        actions,
        unclear: parsed.data.unclear || actions.length === 0,
      };
    } catch (error: unknown) {
      dependencies.logger?.warn({ err: error }, "briefing command not read");
      return UNCLEAR;
    }
  };
}

export type BriefingCommandReader = ReturnType<
  typeof createBriefingCommandReader
>;
