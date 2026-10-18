import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TurnSkimResultSchema,
  type PromptRegistry,
  type TurnSkimResult,
  type TurnSkimV3Variables,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * The fast lane's first read (founder brief K, 2026-10-09): TURN_SKIM, a
 * small prompt beside the full turn reader. Hosted, the full read was the
 * floor of every answer (p50 1.2 s, p95 1.8 s; ~6.6k input and ~180 output
 * tokens); this asks for four fields over a ~1.5k-token prompt whose
 * static part comes first, so it is cached and written quickly. Null when
 * it cannot be had: the full reading answers, as before.
 */

/** One quick attempt: a slow skim is no faster than the full reading. */
const TURN_SKIM_BUDGET = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 160,
  attemptTimeoutMs: 2_500,
} as const;

/** The suffix that marks a skim's usage rows (correlation_id ≤ 128). */
export const TURN_SKIM_CORRELATION_SUFFIX = ":turn-skim";

export function turnSkimCorrelationId(correlationId: string): string {
  return `${correlationId.slice(0, 128 - TURN_SKIM_CORRELATION_SUFFIX.length)}${TURN_SKIM_CORRELATION_SUFFIX}`;
}

export type QTurnSkimInput = {
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly role: "USER" | "Q";
    readonly text: string;
  }[];
  /**
   * W1: the items Q told them on arrival, for ARRIVAL_FOLLOWUP. Empty or
   * absent: the skim reads as before (no such follow-up is possible).
   */
  readonly arrivalItems?:
    | readonly {
        readonly key: string;
        readonly counterpart: string | null;
        readonly headline: string;
      }[]
    | undefined;
  readonly attribution: {
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly qRunId?: string | undefined;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type QTurnSkimmer = {
  readonly skim: (input: QTurnSkimInput) => Promise<TurnSkimResult | null>;
};

export function createTurnSkimmer(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): QTurnSkimmer {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return {
    skim: async (input) => {
      const utterance = input.utterance.trim().slice(0, 1_000);
      if (utterance.length === 0) return null;
      try {
        const rendered = renderPrompt<TurnSkimV3Variables>(registry, {
          task: "TURN_SKIM",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You classify one turn and nothing else; Capital Q decides what follows from it.",
          variables: {
            utterance,
            arrivalItems: JSON.stringify(
              (input.arrivalItems ?? []).slice(0, 6).map((item) => ({
                key: item.key.slice(0, 160),
                counterpart: item.counterpart?.slice(0, 60) ?? null,
                headline: item.headline.slice(0, 100),
              })),
            ).slice(0, 1_500),
            recentTurns: JSON.stringify(
              input.recentTurns.slice(-2).map((turn) => ({
                role: turn.role,
                text: turn.text.slice(0, 300),
              })),
            ).slice(0, 1_500),
          },
        });
        const response = await dependencies.gateway.execute<TurnSkimResult>(
          {
            taskClass: "FAST_CLASSIFICATION",
            reasoning: "LOW",
            sensitivity: dependencies.sensitivity ?? "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: TURN_SKIM_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            // Its own mark in ai_ops.model_usage (same task class as the
            // turn reader): the hosted ledger separates the skim's rows by
            // this suffix on the run's correlation id.
            attribution: {
              ...input.attribution,
              correlationId: turnSkimCorrelationId(
                input.attribution.correlationId,
              ),
            },
          },
          {
            schema: TurnSkimResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const read = TurnSkimResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return read.success ? read.data : null;
      } catch (error: unknown) {
        dependencies.logger?.info(
          { err: error },
          "a turn was not skimmed; the full reading answers it",
        );
        return null;
      }
    },
  };
}
