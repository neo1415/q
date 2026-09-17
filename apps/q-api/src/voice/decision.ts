import type { ModelSensitivity } from "@capital-q/contracts";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DecisionReaderResultSchema,
  renderPrompt,
  type Decision,
  type DecisionReaderResult,
  type DecisionReaderVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

/**
 * Was that a yes? (ADR 0011)
 *
 * Q asked a closed question on the line; the person said something. A
 * word list decided this before, and "Approved." fell through it into a
 * Q run that said the approval had been noted when nothing had been. The
 * reading is a model's now, into a closed shape; what a YES may do stays
 * with the code that asked the question.
 *
 * Latency is the cost, and it is bounded: a fast classification with a
 * short deadline, and the two replies that need no reading at all, a bare
 * "yes" and a bare "no", are read without a call. Everything else is
 * meaning, and meaning is read, not matched.
 */

export type DecisionReading = {
  readonly decision: Decision;
  /** What they said beyond deciding, verbatim, when there was more. */
  readonly remainder: string | null;
};

export type DecisionReader = {
  readonly read: (input: {
    readonly question: string;
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<DecisionReading | null>;
};

export type DecisionReaderDependencies = {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** A person's reply on a call; CONFIDENTIAL keeps it off ineligible providers. */
  readonly sensitivity?: ModelSensitivity | undefined;
};

/** A reply that is only the word: nothing to read, and nothing to wait for. */
function literal(utterance: string): DecisionReading | null {
  const word = utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (word === "yes") return { decision: "YES", remainder: null };
  if (word === "no") return { decision: "NO", remainder: null };
  return null;
}

/** The remainder is theirs only if it is in what they said. */
function remainderOf(
  result: DecisionReaderResult,
  utterance: string,
): string | null {
  const remainder = result.remainder?.trim() ?? "";
  if (remainder.length === 0) return null;
  return utterance.toLowerCase().includes(remainder.toLowerCase())
    ? remainder
    : null;
}

const DECISION_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 200,
  attemptTimeoutMs: 6_000,
} as const;

export function createDecisionReader(
  dependencies: DecisionReaderDependencies,
): DecisionReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    read: async (input) => {
      const direct = literal(input.utterance);
      if (direct !== null) return direct;
      const variables: Omit<
        DecisionReaderVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        question: input.question.slice(0, 600),
        recentTurns: input.recentTurns.slice(-6).map((turn) => ({
          role: turn.role,
          text: turn.text.slice(0, 400),
        })),
        utterance: input.utterance.slice(0, 1_000),
      };
      try {
        const rendered = renderPrompt<DecisionReaderVariables>(registry, {
          task: "DECISION_READER",
          charter: "Q_SYSTEM_VOICE",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You decide nothing and do nothing; Capital Q acts on a YES only where it asked the question.",
          variables,
        });
        const response = await gateway.execute<DecisionReaderResult>(
          {
            taskClass: "FAST_CLASSIFICATION",
            sensitivity,
            budget: DECISION_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          {
            schema: DecisionReaderResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = DecisionReaderResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        return {
          decision: parsed.data.decision,
          remainder: remainderOf(parsed.data, input.utterance),
        };
      } catch (error: unknown) {
        if (isModelGatewayError(error) && error.failureClass === "CANCELLED") {
          return null;
        }
        logger.warn({ err: error }, "a spoken decision was not read");
        return null;
      }
    },
  };
}
