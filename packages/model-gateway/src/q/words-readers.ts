import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  MeetingOutcomeReaderResultSchema,
  OnboardingMoveReaderResultSchema,
  PreferencePolarityResultSchema,
  renderPrompt,
  UtteranceCheckResultSchema,
  type MeetingOutcomeReaderResult,
  type OnboardingMove,
  type OnboardingMoveReaderResult,
  type Polarity,
  type PreferencePolarityResult,
  type PromptRegistry,
  type UtteranceCheckResult,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * People's words read by meaning (founder brief J7, 2026-10-06): the
 * structured FAST_CLASSIFICATION readers that replace the remaining fixed
 * phrase lists. Each is one small, versioned, pinned prompt through the
 * Model Gateway by task class; each answers null when the reading cannot
 * be had (no provider, a timeout, a refusal, an unreadable answer), and
 * every caller treats null as its own safe default -- nothing decided,
 * nothing proposed, nothing cleared.
 *
 * None of these sits in a voice turn's critical path: callers run them
 * beside other work, and the budget below keeps each short and cheap.
 */

export type WordsWho = {
  readonly tenantId: string;
  readonly userId: string | null;
};

const CLASSIFY = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.003,
  maxOutputTokens: 400,
  attemptTimeoutMs: 6_000,
} as const;

export type WordsReaders = {
  /** A setup reply's conversational move; null: not read. */
  readonly onboardingMove: (
    who: WordsWho,
    input: {
      readonly question: string;
      readonly options: readonly string[];
      readonly utterance: string;
    },
  ) => Promise<OnboardingMove | null>;
  /**
   * For each mention (an id, the term, its sentence), what the text says
   * of it. Missing ids were not read; null: nothing read.
   */
  readonly preferencePolarity: (
    who: WordsWho,
    mentions: readonly {
      readonly id: string;
      readonly term: string;
      readonly sentence: string;
    }[],
  ) => Promise<ReadonlyMap<string, Polarity> | null>;
  /** What a call's agreed lines say it led to; null: not read. */
  readonly meetingOutcome: (
    who: WordsWho,
    lines: readonly string[],
  ) => Promise<MeetingOutcomeReaderResult["outcome"] | null>;
  /** One closed question about their words; null: not read. */
  readonly check: (
    who: WordsWho,
    input: { readonly question: string; readonly utterance: string },
  ) => Promise<UtteranceCheckResult["answer"] | null>;
};

export function createWordsReaders(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  readonly registry?: PromptRegistry | undefined;
}): WordsReaders {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();

  async function read<V, O>(
    task:
      | "ONBOARDING_MOVE_READER"
      | "PREFERENCE_POLARITY"
      | "MEETING_OUTCOME_READER"
      | "UTTERANCE_CHECK",
    who: WordsWho,
    variables: V,
    schema: z.ZodType<O>,
  ): Promise<O | null> {
    try {
      const rendered = renderPrompt<V>(registry, {
        task,
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are reading words, not answering anyone. Code decides what happens from your reading.",
        variables,
      });
      const response = await dependencies.gateway.execute<O>(
        {
          taskClass: "FAST_CLASSIFICATION",
          sensitivity: "CONFIDENTIAL",
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget: CLASSIFY,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: who.tenantId,
            ...(who.userId === null ? {} : { userId: who.userId }),
            correlationId: `cor_${randomUUID()}`,
          },
        },
        { schema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      dependencies.logger?.warn({ err: error, task }, "words not read");
      return null;
    }
  }

  return {
    onboardingMove: async (who, input) => {
      const utterance = input.utterance.trim().slice(0, 1_000);
      if (utterance.length === 0) return null;
      const result = await read<
        Record<string, unknown>,
        OnboardingMoveReaderResult
      >(
        "ONBOARDING_MOVE_READER",
        who,
        {
          question: input.question.slice(0, 600) || "A setup question.",
          options:
            input.options.length === 0
              ? "none"
              : input.options.slice(0, 40).join("\n").slice(0, 2_000),
          utterance,
        },
        OnboardingMoveReaderResultSchema,
      );
      return result?.move ?? null;
    },

    preferencePolarity: async (who, mentions) => {
      const shown = mentions.slice(0, 80);
      if (shown.length === 0) return new Map();
      const result = await read<
        Record<string, unknown>,
        PreferencePolarityResult
      >(
        "PREFERENCE_POLARITY",
        who,
        {
          mentions: shown
            .map(
              (one) =>
                `${one.id.slice(0, 40)} | ${one.term.slice(0, 80)} | ${one.sentence.replace(/\s+/gu, " ").slice(0, 300)}`,
            )
            .join("\n")
            .slice(0, 12_000),
        },
        PreferencePolarityResultSchema,
      );
      if (result === null) return null;
      const asked = new Set(shown.map((one) => one.id));
      return new Map(
        result.mentions
          .filter((one) => asked.has(one.id))
          .map((one) => [one.id, one.polarity] as const),
      );
    },

    meetingOutcome: async (who, lines) => {
      const text = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")
        .slice(0, 6_000);
      if (text.length === 0) return null;
      const result = await read<
        Record<string, unknown>,
        MeetingOutcomeReaderResult
      >(
        "MEETING_OUTCOME_READER",
        who,
        { lines: text },
        MeetingOutcomeReaderResultSchema,
      );
      return result?.outcome ?? null;
    },

    check: async (who, input) => {
      const utterance = input.utterance.trim().slice(0, 2_000);
      if (utterance.length === 0) return null;
      const result = await read<Record<string, unknown>, UtteranceCheckResult>(
        "UTTERANCE_CHECK",
        who,
        { question: input.question.slice(0, 600), utterance },
        UtteranceCheckResultSchema,
      );
      return result?.answer ?? null;
    },
  };
}
