import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  factsForVoice,
  renderPrompt,
  SpokenReplyResultSchema,
  spokenFidelityIssues,
  type PromptRegistry,
  type SpokenFacts,
  type SpokenFidelityIssue,
  type SpokenReplyResult,
  type SpokenReplyVariables,
} from "@capital-q/q-core";

/**
 * The standard voice line says a code-built answer in Q's own words
 * (research 2026-10-07 §4, founder live 2026-10-08).
 *
 * Code built the facts (`spokenFactsOf`); one fast model call through the
 * Model Gateway turns them into speech; the result is checked by code
 * (`spokenFidelityIssues`) before a word of it is said. Late, failed or
 * unfaithful: the fact-built fallback is said instead, which passes the
 * same checks. The deadline is short because the person is waiting in
 * silence: a rewrite that arrives after it is worth less than the
 * fallback now.
 */

export type SpokenReplySource = "MODEL" | "FALLBACK";

export type SpokenReply = {
  readonly text: string;
  readonly source: SpokenReplySource;
  /** Why the model's words were not said; empty when they were. */
  readonly issues: readonly SpokenFidelityIssue[];
};

export type SpokenReplier = {
  readonly say: (input: {
    readonly facts: SpokenFacts;
    readonly asked: string;
    readonly lastSaid: string;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<SpokenReply>;
};

/** First words within about two seconds of the end of their turn. */
export const SPOKEN_REPLY_DEADLINE_MS = 1_800;

const BUDGET = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.005,
  maxOutputTokens: 220,
  attemptTimeoutMs: SPOKEN_REPLY_DEADLINE_MS,
} as const;

export function createSpokenReplier(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly deadlineMs?: number | undefined;
  /** Names of their companies and relationships: CONFIDENTIAL by default. */
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
}): SpokenReplier {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const deadlineMs = dependencies.deadlineMs ?? SPOKEN_REPLY_DEADLINE_MS;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    say: async (input) => {
      const fallback = (
        issues: readonly SpokenFidelityIssue[],
      ): SpokenReply => ({
        text: input.facts.fallback,
        source: "FALLBACK",
        issues,
      });
      const deadline = AbortSignal.timeout(deadlineMs);
      const signal =
        input.signal === undefined
          ? deadline
          : AbortSignal.any([input.signal, deadline]);
      try {
        const variables: Omit<
          SpokenReplyVariables,
          | "operatingMode"
          | "communicationProfile"
          | "communicationGuidance"
          | "environmentNotes"
        > = {
          asked: input.asked.slice(0, 1_000) || "(nothing)",
          facts: JSON.stringify(factsForVoice(input.facts)).slice(0, 4_000),
          lastSaid: input.lastSaid.slice(0, 600),
        };
        const rendered = renderPrompt<SpokenReplyVariables>(registry, {
          task: "SPOKEN_REPLY",
          charter: "Q_SYSTEM_VOICE",
          operatingMode: "DEBRIEF",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "A live voice call; the detail is already on their screen. You only choose the words.",
          variables,
        });
        const response = await gateway.execute<SpokenReplyResult>(
          {
            taskClass: "FAST_CLASSIFICATION",
            sensitivity,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: { ...BUDGET, attemptTimeoutMs: deadlineMs },
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          { schema: SpokenReplyResultSchema, signal },
        );
        if (response.output.kind !== "STRUCTURED") return fallback([]);
        const parsed = SpokenReplyResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return fallback([]);
        const said = parsed.data.say.trim();
        const issues = spokenFidelityIssues(said, input.facts);
        if (issues.length > 0) {
          logger.info(
            { issues, kind: input.facts.kind },
            "spoken reply failed its checks; the fact-built line was said",
          );
          return fallback(issues);
        }
        return { text: said, source: "MODEL", issues: [] };
      } catch (error: unknown) {
        // Late or failed: never silence, never the old template.
        logger.info(
          { err: error, late: deadline.aborted, kind: input.facts.kind },
          "spoken reply not in time; the fact-built line was said",
        );
        return fallback([]);
      }
    },
  };
}
