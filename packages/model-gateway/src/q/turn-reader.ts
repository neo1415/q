import type { ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TurnReaderV11ResultSchema,
  type PromptRegistry,
  type TurnReaderV11Result,
  type TurnReaderV7Variables,
} from "@capital-q/q-core";

import { isModelGatewayError } from "../errors.js";
import type { ModelGateway } from "../gateway.js";

/**
 * Reading one turn to Q before it is answered (CQ-QX-005, ADR 0011).
 *
 * The model reads meaning into the core's closed shape; the conversation
 * core decides from it whether Q may go to the public web. A turn that
 * cannot be read — no route, a timeout, output that does not parse — is
 * null, and the caller treats research as not asked for: Q answers from
 * what Capital Q holds rather than guessing its way onto the web.
 */
export type QTurnReader = {
  readonly read: (input: {
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly modality: "VOICE" | "TEXT";
    /**
     * The other actions this run can take, from what is offered: a request
     * for one of them is never read as a document (founder live, BIZ-004).
     */
    readonly actions?:
      readonly { readonly name: string; readonly does: string }[] | undefined;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QTurnReading | null>;
};

/**
 * One turn's reading. `moreDocuments` (v9) and `sequence` (v11, R35) are
 * optional here so a reader that knows neither still fits; absent is none.
 */
export type QTurnReading = Omit<
  TurnReaderV11Result,
  "moreDocuments" | "sequence"
> & {
  readonly moreDocuments?: TurnReaderV11Result["moreDocuments"] | undefined;
  readonly sequence?: TurnReaderV11Result["sequence"] | undefined;
};

/**
 * Small and fast: a classification in front of an answer the person is
 * waiting for. Two attempts so a single failing provider can fall back.
 * The output room is for a reasoning model's thinking as much as for the
 * JSON: at 300 tokens gpt-oss spent it all thinking and returned nothing,
 * which the provider refused as invalid JSON (local, 2026-09-24).
 */
const TURN_READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 6_000,
} as const;

export function createQTurnReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** The person's words; CONFIDENTIAL keeps them off ineligible providers. */
  readonly sensitivity?: ModelSensitivity | undefined;
}): QTurnReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    read: async (input) => {
      const utterance = input.utterance.trim().slice(0, 2_000);
      if (utterance.length === 0) return null;
      const variables: Omit<
        TurnReaderV7Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        recentTurns: input.recentTurns.slice(-6).map((turn) => ({
          role: turn.role,
          text: turn.text.slice(0, 400),
        })),
        utterance,
        modality: input.modality,
        actions: (input.actions ?? []).slice(0, 30).map((action) => ({
          name: action.name.slice(0, 80),
          does: action.does.slice(0, 240),
        })),
      };
      try {
        const rendered = renderPrompt<TurnReaderV7Variables>(registry, {
          task: "TURN_READER",
          charter: "Q_SYSTEM",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You classify one turn and nothing else; Capital Q decides what follows from it.",
          variables,
        });
        const response = await gateway.execute<TurnReaderV11Result>(
          {
            taskClass: "FAST_CLASSIFICATION",
            // A closed classification needs little thought; left unset, a
            // reasoning model thinks at length before a one-line answer.
            reasoning: "LOW",
            sensitivity,
            budget: TURN_READER_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          {
            schema: TurnReaderV11ResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = TurnReaderV11ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success ? parsed.data : null;
      } catch (error: unknown) {
        if (!(
          isModelGatewayError(error) && error.failureClass === "CANCELLED"
        )) {
          logger.warn({ err: error }, "a turn to Q was not read");
        }
        return null;
      }
    },
  };
}
