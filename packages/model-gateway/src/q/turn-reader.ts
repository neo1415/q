import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TurnReaderV24ResultSchema,
  type PromptRegistry,
  type TurnReaderV14Result,
  type TurnReaderV15Result,
  type TurnReaderV22Result,
  type TurnReaderV24Result,
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
  TurnReaderV15Result,
  "moreDocuments" | "sequence" | "addressedToQ"
> & {
  /** v15: false when spoken words were plainly for someone else. */
  readonly addressedToQ?: boolean | undefined;
  readonly moreDocuments?: TurnReaderV14Result["moreDocuments"] | undefined;
  readonly sequence?: TurnReaderV14Result["sequence"] | undefined;
  /** v22: they asked Q for a meeting with someone, or to take it over. */
  readonly handOver?: TurnReaderV22Result["handOver"] | undefined;
  /** v24: they told Q that what they said just before was not for it. */
  readonly earlierNotForQ?: boolean | undefined;
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

/**
 * How long the first model gets when a synthetic-demo posture routes the
 * read to the fast shared model first and another waits behind it. Measured
 * 2026-10-01 (ai_ops.model_usage, 72 h, Gemini flash-lite): 66 reads
 * answered, p90 1.4 s, p99 3.2 s, only 4 over 2.5 s; 8 hung to the 6 s
 * deadline, each a 6 s stall before the fallback read the turn. At 2.5 s a
 * hung read costs 2.5 s and the fallback keeps its full 6 s. Not applied to
 * other postures, where the first model is the slower one (p50 ~2 s).
 */
export const TURN_READER_FAST_FIRST_ATTEMPT_MS = 2_500;

export function createQTurnReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** The person's words; CONFIDENTIAL keeps them off ineligible providers. */
  readonly sensitivity?: ModelSensitivity | undefined;
  /**
   * Doc 15 §62, as every other Q caller declares it: on a deployment that
   * attested its material is synthetic, a faster shared model may read the
   * turn (the routing policy prefers one for FAST_CLASSIFICATION). Absent
   * is REAL_CUSTOMER, where the sensitivity ceiling keeps it off them.
   */
  readonly dataPosture?: ModelDataPosture | undefined;
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
        const response = await gateway.execute<TurnReaderV24Result>(
          {
            taskClass: "FAST_CLASSIFICATION",
            // A closed classification needs little thought; left unset, a
            // reasoning model thinks at length before a one-line answer.
            reasoning: "LOW",
            sensitivity,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: TURN_READER_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          {
            schema: TurnReaderV24ResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            ...(dependencies.dataPosture === "SYNTHETIC_DEMO"
              ? { firstAttemptTimeoutMs: TURN_READER_FAST_FIRST_ATTEMPT_MS }
              : {}),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = TurnReaderV24ResultSchema.safeParse(
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
