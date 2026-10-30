import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TurnSkimV8ResultSchema,
  type PromptRegistry,
  type TurnSkimV8Result,
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

/**
 * One quick attempt: a slow skim is no faster than the full reading.
 *
 * Sized from production (ai_ops.model_usage, 7 days to 2026-10-30, 1,431
 * skims): successful skims wrote p99 110 output tokens, and all 9 refused
 * as invalid JSON stopped at exactly the old 160-token ceiling -- cut off,
 * not wrong. 320 is three times p99 (at most ~USD 0.0004 a skim). 63 skims
 * (4.4%) timed out at 2.5 s while successful ones answered p99 2.4 s: the
 * ceiling sat on the tail. Since the full reading's prompt grew (10-26) it
 * answers p50 3.1 s, so a skim that lands by 3 s still decides first;
 * after that the full reading answers, as before.
 */
export const TURN_SKIM_BUDGET = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 320,
  attemptTimeoutMs: 3_000,
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

/**
 * One skim. `subject` (v6) is optional here so a skim without it still
 * fits; absent is none.
 */
export type QTurnSkim = Omit<
  TurnSkimV8Result,
  "subject" | "writes" | "investors"
> & {
  readonly subject?: TurnSkimV8Result["subject"] | undefined;
  /** v7: they ask Q to write or send something to someone; absent is false. */
  readonly writes?: boolean | undefined;
  /** v8 adds `kinds` (family offices, angel networks); absent is none. */
  readonly investors?:
    | (Omit<NonNullable<TurnSkimV8Result["investors"]>, "kinds"> & {
        readonly kinds?: readonly string[] | undefined;
      })
    | null
    | undefined;
};

export type QTurnSkimmer = {
  readonly skim: (input: QTurnSkimInput) => Promise<QTurnSkim | null>;
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
        const response = await dependencies.gateway.execute<TurnSkimV8Result>(
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
            schema: TurnSkimV8ResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const read = TurnSkimV8ResultSchema.safeParse(
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
